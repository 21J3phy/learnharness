/**
 * A dropped file → its text, page by page.
 *
 *   PDF                 → one page per page (pdf-ops)
 *   PowerPoint (.pptx)  → one page per slide: title, bullets, tables,
 *                         equations, speaker notes
 *   Word (.docx)        → headings, lists, tables, equations, then paged
 *   EPUB                → the book in reading order, then paged
 *   HTML, plain text    → paged
 *
 * Office and EPUB files are ZIP archives of XML. Both are read here with
 * node:zlib and a small tag reader: no dependency, and every inflate is
 * bounded so a crafted archive cannot exhaust memory.
 */

import zlib from "node:zlib";
import { convertPdf } from "../agent/subagents/pdf-ops.ts";
import { unreadableReason } from "../../lib/course-limits.ts";
import type { CourseSource } from "../core/course.ts";
import type { SourcePage } from "../store/courses.ts";

/** A file that can't be taken. `reason` is whole sentences about the file,
 *  without its name ("It is empty."). */
export class SourceFileError extends Error {
	constructor(readonly reason: string) {
		super(reason);
		this.name = "SourceFileError";
	}
}

export interface ConvertedSource {
	kind: CourseSource["kind"];
	pages: SourcePage[];
	notice?: string;
}

const MAX_PAGES = 2000;
/** Flowing text (a document, a book) is cut into pages of about this size. */
const TEXT_PAGE_CHARS = 12_000;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 20_000;

const DAMAGED = "It could not be opened. The file may be damaged.";
const starts = (bytes: Uint8Array, magic: readonly number[]) => magic.every((byte, i) => bytes[i] === byte);
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // "PK\3\4"
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0]; // legacy and password-protected Office

const extensionOf = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export async function convertSource(name: string, bytes: Uint8Array): Promise<ConvertedSource> {
	if (bytes.length === 0) throw new SourceFileError(unreadableReason(name) ?? "It is empty.");
	if (starts(bytes, PDF_MAGIC)) return pdf(bytes);
	if (starts(bytes, ZIP_MAGIC)) return archive(name, bytes);
	if (starts(bytes, OLE_MAGIC)) {
		throw new SourceFileError(/^(?:pptx|ppsx|pptm|docx|docm)$/.test(extensionOf(name))
			? "It is password-protected. Save a copy without the password, or as a PDF."
			: unreadableReason(name) ?? "It is in an old Office format. Save it as .pptx, .docx or PDF.");
	}
	const blocked = unreadableReason(name);
	if (blocked) throw new SourceFileError(blocked);
	if (bytes.subarray(0, 8192).includes(0)) throw new SourceFileError("It isn't a kind of file this can read.");
	const text = new TextDecoder().decode(bytes);
	return flowing(/^x?html?$/.test(extensionOf(name)) ? htmlToText(text) : text);
}

async function pdf(bytes: Uint8Array): Promise<ConvertedSource> {
	const result = await convertPdf(bytes, MAX_PAGES);
	if (result.kind === "unreadable") throw new SourceFileError("It could not be opened as a PDF.");
	if (result.kind === "too-long") throw new SourceFileError(`It is longer than ${MAX_PAGES.toLocaleString("en-US")} pages.`);
	const pages = result.pages.flatMap((p) => (p.kind === "text" ? [{ number: p.number, text: p.markdown }] : []));
	if (pages.length === 0) {
		throw new SourceFileError("It has no selectable text, so it looks like a scan. Scanned pages can't be read yet; use a PDF whose text you can highlight.");
	}
	const skipped = result.pages.filter((p) => p.kind === "image-only").length;
	return { kind: "pdf", pages, ...(skipped > 0 ? { notice: `${plural(skipped, "scanned page was", "scanned pages were")} skipped.` } : {}) };
}

function archive(name: string, bytes: Uint8Array): ConvertedSource {
	let zip: Zip;
	try {
		zip = new Zip(bytes);
	} catch (error) {
		throw error instanceof SourceFileError ? error : new SourceFileError(DAMAGED);
	}
	try {
		if (zip.has("ppt/presentation.xml")) return slides(zip);
		if (zip.has("word/document.xml")) return flowing(docxText(zip));
		if (zip.has("META-INF/container.xml")) return flowing(epubText(zip));
	} catch (error) {
		if (error instanceof SourceFileError) throw error;
		throw new SourceFileError(DAMAGED);
	}
	if (zip.names().some((entry) => entry.startsWith("Index/") || entry === "Index.zip")) {
		throw new SourceFileError(unreadableReason(name) ?? unreadableReason("x.key")!);
	}
	throw new SourceFileError(unreadableReason(name) ?? "It isn't a kind of file this can read.");
}

/** Cut flowing text into pages, on paragraph breaks. */
export function paginate(text: string): SourcePage[] {
	const pages: SourcePage[] = [];
	let current = "";
	for (const paragraph of text.split(/\n{2,}/)) {
		if (current.length + paragraph.length > TEXT_PAGE_CHARS && current) {
			pages.push({ number: pages.length + 1, text: current });
			current = "";
		}
		current += (current ? "\n\n" : "") + paragraph;
	}
	if (current.trim()) pages.push({ number: pages.length + 1, text: current });
	return pages;
}

function flowing(text: string): ConvertedSource {
	const pages = paginate(text);
	if (pages.length === 0) throw new SourceFileError("It has no text.");
	return { kind: "text", pages };
}

// ─── ZIP ─────────────────────────────────────────────────────────────────────

/** Read-only ZIP: the central directory, then entries inflated on demand. */
class Zip {
	private readonly entries = new Map<string, { method: number; size: number; packed: number; offset: number }>();
	private readonly view: DataView;
	private inflated = 0;

	constructor(private readonly bytes: Uint8Array) {
		const view = this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		let end = bytes.length - 22;
		const floor = Math.max(0, end - 0xffff);
		while (end >= floor && view.getUint32(end, true) !== 0x06054b50) end--;
		if (end < floor) throw new Error("no end record");
		const count = view.getUint16(end + 10, true);
		let at = view.getUint32(end + 16, true);
		if (count > MAX_ARCHIVE_ENTRIES) throw new Error("too many entries");
		for (let i = 0; i < count; i++) {
			if (view.getUint32(at, true) !== 0x02014b50) throw new Error("bad directory");
			const nameLength = view.getUint16(at + 28, true);
			const entryName = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
			if (view.getUint16(at + 8, true) & 1) throw new SourceFileError("It is password-protected. Save a copy without the password, or as a PDF.");
			this.entries.set(entryName, {
				method: view.getUint16(at + 10, true),
				packed: view.getUint32(at + 20, true),
				size: view.getUint32(at + 24, true),
				offset: view.getUint32(at + 42, true),
			});
			at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
		}
	}

	names(): string[] { return [...this.entries.keys()]; }
	has(name: string): boolean { return this.entries.has(name); }

	/** An entry's text, or null when the archive has no such entry. */
	text(name: string): string | null {
		const entry = this.entries.get(name);
		if (!entry) return null;
		const tooLarge = new SourceFileError("It is too large to read.");
		if (entry.size > MAX_ENTRY_BYTES || entry.packed > MAX_ENTRY_BYTES) throw tooLarge;
		if (this.view.getUint32(entry.offset, true) !== 0x04034b50) throw new Error("bad entry");
		const start = entry.offset + 30 + this.view.getUint16(entry.offset + 26, true) + this.view.getUint16(entry.offset + 28, true);
		const packed = this.bytes.subarray(start, start + entry.packed);
		if (entry.method !== 0 && entry.method !== 8) throw new Error("unsupported compression");
		let data: Uint8Array = packed;
		if (entry.method === 8) {
			// The declared size is the archive's own claim: bound the real output.
			try {
				data = zlib.inflateRawSync(packed, { maxOutputLength: MAX_ENTRY_BYTES });
			} catch (error) {
				throw (error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE" ? tooLarge : error;
			}
		}
		if ((this.inflated += data.length) > MAX_ARCHIVE_BYTES) throw tooLarge;
		return new TextDecoder().decode(data);
	}
}

/** `target` as an archive path, relative to the folder `base` ("ppt/slides/"). */
function resolveEntry(base: string, target: string): string {
	let clean = target.split("#")[0]!;
	try { clean = decodeURIComponent(clean); } catch { /* keep the raw name */ }
	const out: string[] = [];
	for (const part of (clean.startsWith("/") ? clean : base + clean).split("/")) {
		if (part === "..") out.pop();
		else if (part && part !== ".") out.push(part);
	}
	return out.join("/");
}

const folderOf = (entry: string) => entry.slice(0, entry.lastIndexOf("/") + 1);

// ─── XML ─────────────────────────────────────────────────────────────────────

interface El {
	name: string;
	attrs: Record<string, string>;
	kids: (El | string)[];
}

const NAMED: Record<string, string> = {
	amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
	lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", times: "×", middot: "·", le: "≤", ge: "≥", ne: "≠",
	rarr: "→", larr: "←", minus: "−", deg: "°", copy: "©",
};

// The Greek letters, which course pages lean on.
"alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigmaf sigma tau upsilon phi chi psi omega".split(" ").forEach((letter, i) => {
	NAMED[letter] = String.fromCodePoint(0x3b1 + i);
	if (letter !== "sigmaf") NAMED[letter[0]!.toUpperCase() + letter.slice(1)] = String.fromCodePoint(0x391 + i);
});

function decodeEntities(text: string): string {
	if (!text.includes("&")) return text;
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (whole, body: string) => {
		if (body[0] !== "#") return NAMED[body] ?? whole;
		const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
		try { return String.fromCodePoint(code); } catch { return ""; }
	});
}

/** A forgiving XML reader: elements, attributes and text; nothing else. */
function parseXml(xml: string): El {
	const root: El = { name: "", attrs: {}, kids: [] };
	const stack = [root];
	let at = 0;
	while (at < xml.length) {
		const open = xml.indexOf("<", at);
		const top = stack[stack.length - 1]!;
		if (open < 0) break;
		if (open > at) top.kids.push(decodeEntities(xml.slice(at, open)));
		if (xml.startsWith("<!--", open)) { const end = xml.indexOf("-->", open + 4); at = end < 0 ? xml.length : end + 3; continue; }
		if (xml.startsWith("<![CDATA[", open)) {
			const end = xml.indexOf("]]>", open + 9);
			top.kids.push(xml.slice(open + 9, end < 0 ? xml.length : end));
			at = end < 0 ? xml.length : end + 3;
			continue;
		}
		// The tag's end: the first ">" outside a quoted attribute value.
		let close = open + 1, quote = "";
		for (; close < xml.length; close++) {
			const ch = xml[close]!;
			if (quote) { if (ch === quote) quote = ""; } else if (ch === "\"" || ch === "'") quote = ch; else if (ch === ">") break;
		}
		const tag = xml.slice(open + 1, close);
		at = close + 1;
		if (tag[0] === "?" || tag[0] === "!") continue;
		if (tag[0] === "/") {
			const closing = tag.slice(1).trim();
			const depth = stack.findLastIndex((el) => el.name === closing);
			if (depth > 0) stack.length = depth;
			continue;
		}
		const selfClosing = tag.endsWith("/");
		const elName = /^[^\s/]+/.exec(tag)?.[0] ?? "";
		const attrs: Record<string, string> = {};
		for (const match of tag.slice(elName.length).matchAll(/([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
			attrs[match[1]!] = decodeEntities(match[2] ?? match[3] ?? "");
		}
		const el: El = { name: elName, attrs, kids: [] };
		top.kids.push(el);
		if (!selfClosing) stack.push(el);
	}
	return root;
}

const isEl = (kid: El | string): kid is El => typeof kid !== "string";
const children = (el: El, name?: string): El[] => el.kids.filter((kid): kid is El => isEl(kid) && (!name || kid.name === name));
const child = (el: El | undefined, name: string): El | undefined => el?.kids.find((kid): kid is El => isEl(kid) && kid.name === name);
const rawText = (el: El): string => el.kids.map((kid) => (isEl(kid) ? rawText(kid) : kid)).join("");

function* descendants(el: El, name: string): Generator<El> {
	for (const kid of el.kids) {
		if (!isEl(kid) || kid.name === "mc:Fallback") continue;
		if (kid.name === name) yield kid;
		else yield* descendants(kid, name);
	}
}

// ─── Office text ─────────────────────────────────────────────────────────────

const ACCENTS: Record<string, string> = { "̂": "\\hat", "̃": "\\tilde", "̄": "\\bar", "̅": "\\bar", "̇": "\\dot", "⃗": "\\vec", "→": "\\vec" };

/** An Office equation as LaTeX — enough structure for fractions, powers,
 *  roots and matrices to survive; symbols stay as the characters they are. */
function equation(el: El): string {
	const inner = (e: El | undefined) => (e ? e.kids.map((kid) => (isEl(kid) ? equation(kid) : "")).join("") : "");
	const part = (name: string) => inner(child(el, name));
	const setting = (props: string, name: string) => child(child(el, props), name)?.attrs["m:val"];
	switch (el.name) {
		case "m:t": return rawText(el);
		// A fraction without its bar is a binomial's stack.
		case "m:f": return setting("m:fPr", "m:type") === "noBar" ? `{${part("m:num")} \\atop ${part("m:den")}}` : `\\frac{${part("m:num")}}{${part("m:den")}}`;
		case "m:sSup": return `{${part("m:e")}}^{${part("m:sup")}}`;
		case "m:sSub": return `{${part("m:e")}}_{${part("m:sub")}}`;
		case "m:sSubSup": return `{${part("m:e")}}_{${part("m:sub")}}^{${part("m:sup")}}`;
		case "m:sPre": return `{}_{${part("m:sub")}}^{${part("m:sup")}}{${part("m:e")}}`;
		case "m:rad": { const degree = part("m:deg"); return degree ? `\\sqrt[${degree}]{${part("m:e")}}` : `\\sqrt{${part("m:e")}}`; }
		case "m:d": {
			const begin = setting("m:dPr", "m:begChr") ?? "(", end = setting("m:dPr", "m:endChr") ?? ")";
			const brace = (ch: string) => (ch === "{" || ch === "}" ? `\\${ch}` : ch || ".");
			return `\\left${brace(begin)}${children(el, "m:e").map(inner).join(setting("m:dPr", "m:sepChr") ?? " | ")}\\right${brace(end)}`;
		}
		case "m:m": return `\\begin{matrix}${children(el, "m:mr").map((row) => children(row, "m:e").map(inner).join(" & ")).join(" \\\\ ")}\\end{matrix}`;
		case "m:eqArr": return children(el, "m:e").map(inner).join(" \\\\ ");
		case "m:nary": {
			const sub = part("m:sub"), sup = part("m:sup");
			return `${setting("m:naryPr", "m:chr") ?? "∫"}${sub ? `_{${sub}}` : ""}${sup ? `^{${sup}}` : ""} ${part("m:e")}`;
		}
		case "m:func": return `${part("m:fName")} ${part("m:e")}`;
		case "m:acc": return `${ACCENTS[setting("m:accPr", "m:chr") ?? "̂"] ?? "\\hat"}{${part("m:e")}}`;
		case "m:bar": return `\\overline{${part("m:e")}}`;
		case "m:limLow": return `{${part("m:e")}}_{${part("m:lim")}}`;
		case "m:limUpp": return `{${part("m:e")}}^{${part("m:lim")}}`;
		default: return el.name.endsWith("Pr") ? "" : inner(el);
	}
}

const SILENT = new Set(["a:pPr", "a:rPr", "a:endParaRPr", "w:pPr", "w:rPr", "w:instrText", "w:del", "w:delText", "mc:Fallback", "w:footnoteReference", "w:endnoteReference"]);

/** The text of one paragraph (DrawingML or WordprocessingML). */
function runText(el: El): string {
	let out = "";
	for (const kid of el.kids) {
		if (!isEl(kid) || SILENT.has(kid.name)) continue;
		if (kid.name === "a:t" || kid.name === "w:t") out += rawText(kid);
		else if (kid.name === "a:br" || kid.name === "w:br" || kid.name === "w:cr") out += "\n";
		else if (kid.name === "w:tab") out += "\t";
		else if (kid.name === "m:oMath") out += ` $${equation(kid).trim()}$ `;
		else if (kid.name === "a:fld" && /^(?:slidenum|datetime)/.test(kid.attrs.type ?? "")) continue;
		else if (kid.name === "w:p") out += `\n${runText(kid)}`;
		else out += runText(kid);
	}
	return out;
}

const tidy = (text: string) => text.replace(/[ \t ]+/g, " ").replace(/ ?\n ?/g, "\n").trim();
const oneLine = (text: string) => tidy(text).replace(/\n+/g, " ");

function tableOf(rows: string[][]): string {
	const lines = rows.filter((row) => row.some((cell) => cell)).map((row) => `| ${row.map((cell) => cell.replaceAll("|", "\\|")).join(" | ")} |`);
	if (lines.length > 1) lines.splice(1, 0, `|${" --- |".repeat(rows[0]!.length)}`);
	return lines.join("\n");
}

// ─── PowerPoint ──────────────────────────────────────────────────────────────

/** Relationship id → archive path, for the part at `entry`. */
function relationships(zip: Zip, entry: string): { id: string; type: string; target: string }[] {
	const folder = folderOf(entry);
	const xml = zip.text(`${folder}_rels/${entry.slice(folder.length)}.rels`);
	if (!xml) return [];
	return [...descendants(parseXml(xml), "Relationship")]
		.filter((rel) => rel.attrs.TargetMode !== "External")
		.map((rel) => ({ id: rel.attrs.Id ?? "", type: rel.attrs.Type ?? "", target: resolveEntry(folder, rel.attrs.Target ?? "") }));
}

/** Placeholders that repeat on every slide and teach nothing. */
const FURNITURE = new Set(["sldNum", "dt", "ftr", "hdr", "sldImg"]);

function slideText(root: El): string {
	let title = "";
	const lines: string[] = [];
	const visit = (el: El) => {
		for (const kid of children(el)) {
			if (kid.name === "mc:Fallback") continue;
			if (kid.name === "p:sp") {
				const placeholder = child(child(child(kid, "p:nvSpPr"), "p:nvPr"), "p:ph");
				const type = placeholder?.attrs.type;
				if (type && FURNITURE.has(type)) continue;
				const paragraphs = children(child(kid, "p:txBody") ?? { name: "", attrs: {}, kids: [] }, "a:p")
					.map((p) => ({ text: oneLine(runText(p)), level: Number(child(p, "a:pPr")?.attrs.lvl ?? 0) || 0 }))
					.filter((p) => p.text);
				if (type === "title" || type === "ctrTitle") title ||= paragraphs.map((p) => p.text).join(" ");
				else if (placeholder && type !== "subTitle") lines.push(...paragraphs.map((p) => `${"  ".repeat(Math.min(p.level, 6))}- ${p.text}`));
				else lines.push(...paragraphs.map((p) => p.text));
			} else if (kid.name === "a:tbl") {
				lines.push(tableOf(children(kid, "a:tr").map((row) => children(row, "a:tc").map((cell) => oneLine([...descendants(cell, "a:p")].map(runText).join(" "))))));
			} else {
				visit(kid);
			}
		}
	};
	visit(root);
	return [title && `# ${title}`, lines.filter(Boolean).join("\n")].filter(Boolean).join("\n\n");
}

function notesText(root: El): string {
	const paragraphs: string[] = [];
	// Not every writer marks the notes box as the "body" placeholder: take
	// every text box that is not page furniture.
	for (const shape of descendants(root, "p:sp")) {
		if (FURNITURE.has(child(child(child(shape, "p:nvSpPr"), "p:nvPr"), "p:ph")?.attrs.type ?? "")) continue;
		for (const p of descendants(shape, "a:p")) paragraphs.push(oneLine(runText(p)));
	}
	return paragraphs.filter(Boolean).join("\n");
}

function slides(zip: Zip): ConvertedSource {
	const deck = "ppt/presentation.xml";
	const targets = new Map(relationships(zip, deck).map((rel) => [rel.id, rel.target]));
	let order = [...descendants(parseXml(zip.text(deck) ?? ""), "p:sldId")]
		.map((slide) => targets.get(slide.attrs["r:id"] ?? ""))
		.filter((entry): entry is string => !!entry && zip.has(entry));
	if (order.length === 0) {
		const numbered = (entry: string) => Number(/^ppt\/slides\/slide(\d+)\.xml$/.exec(entry)?.[1] ?? NaN);
		order = zip.names().filter((entry) => !Number.isNaN(numbered(entry))).sort((a, b) => numbered(a) - numbered(b));
	}
	if (order.length > MAX_PAGES) throw new SourceFileError(`It is longer than ${MAX_PAGES.toLocaleString("en-US")} slides.`);
	const pages: SourcePage[] = [];
	order.forEach((entry, i) => {
		let text = slideText(parseXml(zip.text(entry) ?? ""));
		const notesEntry = relationships(zip, entry).find((rel) => rel.type.endsWith("/notesSlide"))?.target;
		const notes = notesEntry ? notesText(parseXml(zip.text(notesEntry) ?? "")) : "";
		if (notes) text += `${text ? "\n\n" : ""}Speaker notes:\n${notes}`;
		if (text.trim()) pages.push({ number: i + 1, text });
	});
	if (pages.length === 0) throw new SourceFileError("Its slides have no text, only pictures. Pictures can't be read yet.");
	const blank = order.length - pages.length;
	return { kind: "slides", pages, ...(blank > 0 ? { notice: `${plural(blank, "slide has", "slides have")} no text (pictures only) and ${blank === 1 ? "was" : "were"} skipped.` } : {}) };
}

// ─── Word ────────────────────────────────────────────────────────────────────

function docxText(zip: Zip): string {
	const body = descendants(parseXml(zip.text("word/document.xml") ?? ""), "w:body").next().value as El | undefined;
	if (!body) return "";
	const blocks: string[] = [];
	const read = (container: El) => {
		for (const kid of children(container)) {
			if (kid.name === "w:p") {
				const text = tidy(runText(kid));
				if (!text) continue;
				const props = child(kid, "w:pPr");
				const style = child(props, "w:pStyle")?.attrs["w:val"] ?? "";
				const outline = child(props, "w:outlineLvl")?.attrs["w:val"];
				const heading = /^title$/i.test(style) ? 1 : /^subtitle$/i.test(style) ? 2
					: Number(/^heading\s?(\d)$/i.exec(style)?.[1] ?? (outline !== undefined ? Number(outline) + 1 : 0));
				const list = child(props, "w:numPr");
				if (heading > 0) blocks.push(`${"#".repeat(Math.min(heading, 6))} ${oneLine(text)}`);
				else if (list) {
					const item = `${"  ".repeat(Math.min(Number(child(list, "w:ilvl")?.attrs["w:val"] ?? 0) || 0, 6))}- ${oneLine(text)}`;
					// Items of one list stay together: a blank line would end it.
					if (/^\s*- /.test(blocks[blocks.length - 1]?.split("\n").pop() ?? "")) blocks[blocks.length - 1] += `\n${item}`;
					else blocks.push(item);
				} else blocks.push(text);
			} else if (kid.name === "w:tbl") {
				blocks.push(tableOf(children(kid, "w:tr").map((row) => children(row, "w:tc").map((cell) => oneLine(children(cell, "w:p").map(runText).join(" "))))));
			} else if (kid.name === "w:sdt") {
				const content = child(kid, "w:sdtContent");
				if (content) read(content);
			}
		}
	};
	read(body);
	return blocks.filter(Boolean).join("\n\n");
}

// ─── EPUB and HTML ───────────────────────────────────────────────────────────

const BLOCK_TAGS = "p|div|section|article|header|footer|main|aside|blockquote|pre|ul|ol|dl|dt|dd|table|thead|tbody|tr|figure|figcaption|h[1-6]";

export function htmlToText(html: string): string {
	const text = html
		.replace(/<!--[\s\S]*?-->/g, " ")
		.replace(/<(script|style|head|svg|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, " ")
		.replace(/\s+/g, " ")
		// An equation keeps its LaTeX when the page carries it.
		.replace(/<math\b([^>]*)>([\s\S]*?)<\/math\s*>/gi, (_, attrs: string, inner: string) => {
			const tex = /\balttext\s*=\s*"([^"]+)"/i.exec(attrs)?.[1] ?? /<annotation\b[^>]*x-tex[^>]*>([\s\S]*?)<\/annotation\s*>/i.exec(inner)?.[1];
			return tex ? ` $${tex.trim()}$ ` : ` ${inner.replace(/<annotation\b[\s\S]*?<\/annotation(?:-xml)?\s*>/gi, "")} `;
		})
		.replace(/<img\b[^>]*?\balt\s*=\s*"([^"]+)"[^>]*>/gi, " $1 ")
		.replace(/<h([1-6])\b[^>]*>/gi, (_, level: string) => `\n\n${"#".repeat(Number(level))} `)
		.replace(/<li\b[^>]*>/gi, "\n- ")
		.replace(/<(?:br|hr)\b[^>]*>/gi, "\n")
		.replace(/<\/t[dh]\s*>/gi, " | ")
		.replace(new RegExp(`</?(?:${BLOCK_TAGS})\\b[^>]*>`, "gi"), "\n\n")
		.replace(/<[^>]+>/g, "");
	return decodeEntities(text).split("\n").map((line) => line.replace(/[ \t ]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function epubText(zip: Zip): string {
	const packagePath = [...descendants(parseXml(zip.text("META-INF/container.xml") ?? ""), "rootfile")][0]?.attrs["full-path"];
	const opf = packagePath ? zip.text(packagePath) : null;
	if (!packagePath || !opf) throw new SourceFileError(DAMAGED);
	const pack = parseXml(opf);
	const named = (name: string) => [...descendants(pack, name), ...descendants(pack, `opf:${name}`)];
	const items = new Map(named("item").map((item) => [item.attrs.id ?? "", { entry: resolveEntry(folderOf(packagePath), item.attrs.href ?? ""), type: item.attrs["media-type"] ?? "" }]));
	const chapters = named("itemref").map((ref) => items.get(ref.attrs.idref ?? "")).filter((item) => item && /html/i.test(item.type)).map((item) => item!.entry);
	const rights = parseXml(zip.text("META-INF/encryption.xml") ?? "");
	const locked = new Set([...descendants(rights, "enc:CipherReference"), ...descendants(rights, "CipherReference")].map((ref) => resolveEntry("", ref.attrs.URI ?? "")));
	if (chapters.some((entry) => locked.has(entry))) throw new SourceFileError("It is copy-protected, so its text can't be read.");
	return chapters.map((entry) => htmlToText(zip.text(entry) ?? "")).filter(Boolean).join("\n\n");
}
