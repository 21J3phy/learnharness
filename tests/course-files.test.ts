import assert from "node:assert/strict";
import { describe, it } from "node:test";
import zlib from "node:zlib";
import { batchesOf, sortFiles, sourceSize } from "../components/course/files.ts";
import { COURSE_ACCEPT, MAX_COURSE_FILES, nothingRead, unreadableReason } from "../lib/course-limits.ts";
import { SourceFileError, convertSource, htmlToText, paginate } from "../src/server/course-files.ts";

const enc = new TextEncoder();

/** A minimal ZIP writer (no checksums: the reader does not verify them). */
function zip(files: Record<string, string | Uint8Array>, options: { store?: boolean; encrypted?: boolean; claimedSize?: number } = {}): Uint8Array {
	const chunks: Buffer[] = [];
	const directory: Buffer[] = [];
	let offset = 0;
	for (const [name, content] of Object.entries(files)) {
		const raw = Buffer.from(typeof content === "string" ? enc.encode(content) : content);
		const data = options.store ? raw : zlib.deflateRawSync(raw);
		const nameBytes = Buffer.from(name, "utf-8");
		const head = Buffer.alloc(30);
		head.writeUInt32LE(0x04034b50, 0);
		head.writeUInt16LE(20, 4);
		head.writeUInt16LE(0x0800 | (options.encrypted ? 1 : 0), 6);
		head.writeUInt16LE(options.store ? 0 : 8, 8);
		head.writeUInt32LE(data.length, 18);
		head.writeUInt32LE(options.claimedSize ?? raw.length, 22);
		head.writeUInt16LE(nameBytes.length, 26);
		const entry = Buffer.alloc(46);
		entry.writeUInt32LE(0x02014b50, 0);
		entry.writeUInt16LE(20, 4);
		entry.writeUInt16LE(20, 6);
		head.copy(entry, 8, 6, 30); // flags … name length
		entry.writeUInt32LE(offset, 42);
		chunks.push(head, nameBytes, data);
		directory.push(entry, nameBytes);
		offset += head.length + nameBytes.length + data.length;
	}
	const directoryBytes = Buffer.concat(directory);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(Object.keys(files).length, 8);
	end.writeUInt16LE(Object.keys(files).length, 10);
	end.writeUInt32LE(directoryBytes.length, 12);
	end.writeUInt32LE(offset, 16);
	return new Uint8Array(Buffer.concat([...chunks, directoryBytes, end]));
}

const reasonOf = async (name: string, bytes: Uint8Array): Promise<string> => {
	try {
		await convertSource(name, bytes);
	} catch (error) {
		assert.ok(error instanceof SourceFileError, `expected a SourceFileError, got ${String(error)}`);
		return error.reason;
	}
	assert.fail(`"${name}" was read`);
};

// ─── PowerPoint ──────────────────────────────────────────────────────────────

const NS = `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"`;
const shape = (placeholder: string, paragraphs: string) =>
	`<p:sp><p:nvSpPr><p:cNvPr id="2" name="x"/><p:cNvSpPr/><p:nvPr>${placeholder}</p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/>${paragraphs}</p:txBody></p:sp>`;
const para = (text: string, level?: number) => `<a:p>${level ? `<a:pPr lvl="${level}"/>` : ""}<a:r><a:rPr lang="en-US"/><a:t>${text}</a:t></a:r></a:p>`;
const slide = (body: string) => `<?xml version="1.0" encoding="UTF-8"?><p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/>${body}</p:spTree></p:cSld></p:sld>`;
const rels = (items: [id: string, type: string, target: string][]) =>
	`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`).join("")}</Relationships>`;

const FRACTION = `<m:oMath><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath>`;
const MATRIX = `<m:oMath><m:r><m:t>A=</m:t></m:r><m:d><m:dPr><m:begChr m:val="["/><m:endChr m:val="]"/></m:dPr><m:e><m:m><m:mr><m:e><m:r><m:t>1</m:t></m:r></m:e><m:e><m:r><m:t>2</m:t></m:r></m:e></m:mr><m:mr><m:e><m:r><m:t>3</m:t></m:r></m:e><m:e><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:e></m:mr></m:m></m:e></m:d></m:oMath>`;

function deck(): Uint8Array {
	return zip({
		"[Content_Types].xml": "<Types/>",
		// The deck's order is the presentation's, not the file names': slide2 is shown first.
		"ppt/presentation.xml": `<p:presentation ${NS}><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/><p:sldId id="258" r:id="rId3"/></p:sldIdLst></p:presentation>`,
		"ppt/_rels/presentation.xml.rels": rels([["rId1", "slide", "slides/slide1.xml"], ["rId2", "slide", "slides/slide2.xml"], ["rId3", "slide", "slides/slide3.xml"], ["rId9", "slideMaster", "slideMasters/slideMaster1.xml"]]),
		"ppt/slides/slide2.xml": slide(
			shape(`<p:ph type="ctrTitle"/>`, para("Linear independence"))
			+ shape(`<p:ph type="sldNum" idx="12"/>`, `<a:p><a:fld id="{1}" type="slidenum"><a:t>7</a:t></a:fld></a:p>`)
			+ shape(`<p:ph idx="1"/>`, para("A set is independent when") + para("only the trivial combination gives 0", 1) + para("Tom &amp; Jerry &lt;3")),
		),
		"ppt/slides/_rels/slide2.xml.rels": rels([["rId1", "notesSlide", "../notesSlides/notesSlide1.xml"], ["rId2", "slideLayout", "../slideLayouts/slideLayout1.xml"]]),
		"ppt/notesSlides/notesSlide1.xml": `<p:notes ${NS}><p:cSld><p:spTree>${shape(`<p:ph type="sldImg"/>`, "")}${shape(`<p:ph type="body" idx="1"/>`, para("Ask for a counterexample."))}${shape(`<p:ph type="sldNum"/>`, para("7"))}</p:spTree></p:cSld></p:notes>`,
		"ppt/slides/slide1.xml": slide(
			shape(`<p:ph type="title"/>`, para("Rank"))
			+ `<mc:AlternateContent><mc:Choice Requires="a14">${shape("", `<a:p><a:r><a:t>Slope </a:t></a:r><a14:m xmlns:a14="x"><m:oMathPara>${FRACTION}</m:oMathPara></a14:m></a:p><a:p>${MATRIX}</a:p>`)}</mc:Choice><mc:Fallback>${shape("", para("FALLBACK PICTURE TEXT"))}</mc:Fallback></mc:AlternateContent>`
			+ `<p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody>${para("Matrix")}</a:txBody></a:tc><a:tc><a:txBody>${para("Rank")}</a:txBody></a:tc></a:tr><a:tr><a:tc><a:txBody>${para("I")}</a:txBody></a:tc><a:tc><a:txBody>${para("n")}</a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`,
		),
		"ppt/slides/slide3.xml": slide(`<p:pic><p:nvPicPr><p:cNvPr id="4" name="Picture"/></p:nvPicPr></p:pic>`),
	});
}

describe("PowerPoint decks", () => {
	it("reads one page per slide, in the presentation's order, with titles, bullets and notes", async () => {
		const out = await convertSource("Lecture 3.pptx", deck());
		assert.equal(out.kind, "slides");
		assert.deepEqual(out.pages.map((p) => p.number), [1, 2]);
		assert.equal(out.pages[0]!.text, [
			"# Linear independence",
			"",
			"- A set is independent when",
			"  - only the trivial combination gives 0",
			"- Tom & Jerry <3",
			"",
			"Speaker notes:",
			"Ask for a counterexample.",
		].join("\n"));
	});

	it("keeps equations and tables, and drops the picture fallback of an equation", async () => {
		const text = (await convertSource("Lecture 3.pptx", deck())).pages[1]!.text;
		assert.match(text, /^# Rank\n/);
		assert.ok(text.includes("Slope $\\frac{a}{b}$"), text);
		assert.ok(text.includes("$A=\\left[\\begin{matrix}1 & 2 \\\\ 3 & {x}^{2}\\end{matrix}\\right]$"), text);
		assert.ok(text.includes("| Matrix | Rank |\n| --- | --- |\n| I | n |"), text);
		assert.ok(!text.includes("FALLBACK"), text);
	});

	it("says how many slides were only pictures", async () => {
		assert.equal((await convertSource("Lecture 3.pptx", deck())).notice, "1 slide has no text (pictures only) and was skipped.");
	});

	it("falls back to the slide files' numbers when the presentation lists none", async () => {
		const out = await convertSource("a.pptx", zip({
			"ppt/presentation.xml": `<p:presentation ${NS}/>`,
			"ppt/slides/slide10.xml": slide(shape("", para("ten"))),
			"ppt/slides/slide2.xml": slide(shape("", para("two"))),
		}, { store: true }));
		assert.deepEqual(out.pages.map((p) => p.text), ["two", "ten"]);
	});

	it("refuses a deck of pictures", async () => {
		const pictures = zip({ "ppt/presentation.xml": `<p:presentation ${NS}/>`, "ppt/slides/slide1.xml": slide("<p:pic/>") });
		assert.match(await reasonOf("scan.pptx", pictures), /no text, only pictures/);
	});
});

// ─── Word ────────────────────────────────────────────────────────────────────

const W = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"`;
const wp = (text: string, props = "") => `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ""}<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

describe("Word documents", () => {
	it("reads headings, lists, tables and equations as Markdown", async () => {
		const body = [
			wp("Course outline", `<w:pStyle w:val="Title"/>`),
			wp("Week 1", `<w:pStyle w:val="Heading2"/>`),
			`<w:p><w:r><w:t>Vectors </w:t></w:r><w:r><w:tab/><w:t>and</w:t><w:br/><w:t>spans</w:t></w:r><w:del><w:r><w:delText>REMOVED</w:delText></w:r></w:del></w:p>`,
			wp("Row reduction", `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>`),
			wp("Pivots", `<w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr>`),
			`<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Exam</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Date</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Midterm</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Oct 9</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`,
			`<w:p><w:r><w:t>Solve </w:t></w:r>${FRACTION}<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:t> now</w:t></mc:Choice><mc:Fallback><w:t>TWICE</w:t></mc:Fallback></mc:AlternateContent></w:r></w:p>`,
			`<w:sdt><w:sdtContent>${wp("Inside a content control")}</w:sdtContent></w:sdt>`,
			`<w:sectPr/>`,
		].join("");
		const out = await convertSource("Syllabus.docx", zip({ "word/document.xml": `<w:document ${W}><w:body>${body}</w:body></w:document>` }));
		assert.equal(out.kind, "text");
		assert.equal(out.pages.map((p) => p.text).join("\n\n"), [
			"# Course outline",
			"## Week 1",
			"Vectors and\nspans",
			"- Row reduction\n  - Pivots",
			"| Exam | Date |\n| --- | --- |\n| Midterm | Oct 9 |",
			"Solve $\\frac{a}{b}$ now",
			"Inside a content control",
		].join("\n\n"));
	});
});

// ─── EPUB and HTML ───────────────────────────────────────────────────────────

function book(extra: Record<string, string> = {}): Uint8Array {
	return zip({
		"mimetype": "application/epub+zip",
		"META-INF/container.xml": `<container><rootfiles><rootfile full-path="OEBPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
		"OEBPS/book.opf": `<package><manifest><item id="c2" href="text/ch%202.xhtml" media-type="application/xhtml+xml"/><item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/><item id="css" href="s.css" media-type="text/css"/></manifest><spine><itemref idref="c1"/><itemref idref="css"/><itemref idref="c2"/></spine></package>`,
		"OEBPS/text/ch1.xhtml": `<html><head><title>Hidden</title><style>p { color: red }</style></head><body><h1>Vector spaces</h1><p>A set\n   closed under <em>addition</em>.</p><ul><li>Zero vector</li><li>Inverses</li></ul></body></html>`,
		"OEBPS/text/ch 2.xhtml": `<html><body><h2>Bases</h2><p>Dimension is <math alttext="\\dim V"><mi>dim</mi><mi>V</mi></math>.</p></body></html>`,
		...extra,
	});
}

describe("EPUB books and web pages", () => {
	it("reads a book's chapters in reading order", async () => {
		const out = await convertSource("book.epub", book());
		assert.equal(out.kind, "text");
		assert.equal(out.pages[0]!.text, "# Vector spaces\n\nA set closed under addition.\n\n- Zero vector\n- Inverses\n\n## Bases\n\nDimension is $\\dim V$ .");
	});

	it("refuses a copy-protected book", async () => {
		const locked = book({ "META-INF/encryption.xml": `<encryption><enc:EncryptedData><enc:CipherData><enc:CipherReference URI="OEBPS/text/ch1.xhtml"/></enc:CipherData></enc:EncryptedData></encryption>` });
		assert.match(await reasonOf("book.epub", locked), /copy-protected/);
	});

	it("leaves a book's obfuscated fonts alone", async () => {
		const fonts = book({ "META-INF/encryption.xml": `<encryption><enc:EncryptedData><enc:CipherData><enc:CipherReference URI="OEBPS/fonts/a.otf"/></enc:CipherData></enc:EncryptedData></encryption>` });
		assert.equal((await convertSource("book.epub", fonts)).pages.length, 1);
	});

	it("turns a web page into text", async () => {
		const out = await convertSource("notes.html", enc.encode(`<!doctype html><html><head><script>var a = "<p>no</p>";</script></head><body><h2>Eigenvalues &amp; eigenvectors</h2><p>Solve<br>det(A &minus; &lambda;I) = 0 &#8212; done.</p><table><tr><td>a</td><td>b</td></tr></table></body></html>`));
		assert.equal(out.pages[0]!.text, "## Eigenvalues & eigenvectors\n\nSolve\ndet(A − λI) = 0 — done.\n\na | b |");
	});

	it("keeps an equation's LaTeX annotation", () => {
		assert.equal(htmlToText(`<p>So <math><semantics><mrow><mi>x</mi></mrow><annotation encoding="application/x-tex">x^2</annotation></semantics></math></p>`), "So $x^2$");
	});
});

// ─── everything else ─────────────────────────────────────────────────────────

describe("files that can't be read", () => {
	it("says what to do with Keynote, old Office and protected files", async () => {
		assert.match(await reasonOf("deck.key", zip({ "Index/Document.iwa": "x", "Metadata/Properties.plist": "x" })), /Export To › PowerPoint or PDF/);
		// A Keynote deck under another name is still recognised by its contents.
		assert.match(await reasonOf("deck.pptx", zip({ "Index/Document.iwa": "x" })), /Keynote/);
		const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
		assert.match(await reasonOf("old.ppt", ole), /old PowerPoint format/);
		assert.match(await reasonOf("locked.pptx", ole), /password-protected/);
		assert.match(await reasonOf("locked.docx", zip({ "word/document.xml": "<w:document/>" }, { encrypted: true })), /password-protected/);
	});

	it("turns away pictures, empty files, binaries and damaged archives", async () => {
		assert.equal(await reasonOf("board.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0])), "Pictures can't be read yet.");
		assert.equal(await reasonOf("notes.txt", new Uint8Array()), "It is empty.");
		assert.equal(await reasonOf("blob.txt", new Uint8Array([1, 2, 0, 4])), "It isn't a kind of file this can read.");
		assert.equal(await reasonOf("notes.txt", enc.encode("  \n\n ")), "It has no text.");
		assert.match(await reasonOf("cut.pptx", deck().subarray(0, 400)), /may be damaged/);
		assert.match(await reasonOf("other.zip", zip({ "readme.txt": "hi" })), /Unpack it/);
	});

	it("bounds what an archive may inflate to", async () => {
		// 80 MB of zeros packs to a few KB — and the archive claims it is tiny.
		const files = { "ppt/presentation.xml": `<p:presentation ${NS}/>`, "ppt/slides/slide1.xml": new Uint8Array(80 * 1024 * 1024) };
		assert.equal(await reasonOf("bomb.pptx", zip(files, { claimedSize: 100 })), "It is too large to read.");
		assert.equal(await reasonOf("honest.pptx", zip(files)), "It is too large to read.");
	});
});

describe("plain text", () => {
	it("cuts flowing text into pages on paragraph breaks", async () => {
		const paragraph = "word ".repeat(1000).trim(); // 4,999 characters
		const out = await convertSource("notes.md", enc.encode([paragraph, paragraph, paragraph, paragraph].join("\n\n")));
		assert.equal(out.kind, "text");
		assert.deepEqual(out.pages.map((p) => p.number), [1, 2]);
		assert.ok(out.pages.every((p) => !p.text.startsWith("\n") && p.text.length <= 12_000));
		assert.deepEqual(paginate(""), []);
	});
});

// ─── a drop, sorted in the browser ───────────────────────────────────────────

describe("sorting a drop", () => {
	const file = (name: string, size = 10) => ({ name, size }) as unknown as File;

	it("reads what it can, in reading order, and sets the rest aside with why", () => {
		const { take, skipped } = sortFiles([file("Lecture 10.pptx"), file("deck.key"), file("Lecture 2.pptx"), file("board.PNG"), file("Syllabus.pdf"), file("notes.xyz"), file("huge.pdf", 151 * 1024 * 1024)]);
		assert.deepEqual(take.map((f) => f.name), ["Lecture 2.pptx", "Lecture 10.pptx", "Syllabus.pdf"]);
		assert.deepEqual(skipped.map((f) => f.name), ["board.PNG", "deck.key", "huge.pdf", "notes.xyz"]);
		assert.equal(skipped[0]!.reason, "Pictures can't be read yet.");
		assert.match(skipped[1]!.reason, /Keynote/);
		assert.equal(skipped[2]!.reason, "It is larger than 150 MB.");
		assert.equal(skipped[3]!.reason, "It isn't a kind of file this can read.");
	});

	it("takes every kind the picker offers", () => {
		const names = COURSE_ACCEPT.split(",").map((extension) => `a${extension}`);
		assert.ok(names.includes("a.pptx") && names.includes("a.docx") && names.includes("a.epub") && names.includes("a.pdf"));
		assert.equal(sortFiles(names.map((name) => file(name))).skipped.length, 0);
		assert.ok(names.every((name) => unreadableReason(name) === null), "a readable kind has no refusal");
	});

	it("caps one drop", () => {
		const { take, skipped } = sortFiles(Array.from({ length: MAX_COURSE_FILES + 2 }, (_, i) => file(`n${i}.md`)));
		assert.equal(take.length, MAX_COURSE_FILES);
		assert.equal(skipped.length, 2);
	});

	it("splits a large drop into uploads that keep the order", () => {
		const sizes = (batches: { size: number }[][]) => batches.map((batch) => batch.map((f) => f.size));
		assert.deepEqual(sizes(batchesOf([{ size: 40 }, { size: 50 }, { size: 30 }, { size: 120 }, { size: 10 }], 100)), [[40, 50], [30], [120], [10]]);
		assert.deepEqual(batchesOf([], 100), []);
		assert.equal(batchesOf([{ size: 0 }, { size: 0 }], 100).length, 1);
	});

	it("says what went wrong when nothing could be read", () => {
		assert.equal(nothingRead([{ name: "deck.ppt", reason: "It is in the old PowerPoint format. Save it as .pptx or PDF." }]), "“deck.ppt” wasn't read. It is in the old PowerPoint format. Save it as .pptx or PDF.");
		assert.match(nothingRead([{ name: "a.png", reason: "Pictures can't be read yet." }, { name: "b.png", reason: "Pictures can't be read yet." }]), /^None of these 2 files could be read\. a\.png: Pictures/);
	});

	it("names a source's size in its own unit", () => {
		assert.equal(sourceSize({ kind: "slides", pages: 24 }), "24 slides");
		assert.equal(sourceSize({ kind: "pdf", pages: 1 }), "1 page");
		assert.equal(sourceSize({ kind: "text", pages: 3 }), "");
	});
});
