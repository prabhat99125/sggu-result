const fs = require("fs");
const path = require("path");
const https = require("https");
const cheerio = require("cheerio");

// ---------------- FOLDERS ----------------
const RESULT_DIR = path.join(__dirname, "result");
if (!fs.existsSync(RESULT_DIR)) fs.mkdirSync(RESULT_DIR, { recursive: true });


// ---------------- FETCH HTML WITH RETRY ----------------
async function fetchHtml(url, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await new Promise((resolve, reject) => {
                https.get(url, { rejectUnauthorized: false }, res => {
                    let html = "";
                    res.on("data", chunk => html += chunk);
                    res.on("end", () => resolve(html));
                    res.on("error", reject);
                });
            });
        } catch (err) {
            if (attempt === retries) throw err;
            await new Promise(res => setTimeout(res, 1000));
        }
    }
    return "";
}

// ---------------- PARSE HTML ----------------
function parseHtml(html) {
    const $ = cheerio.load(html);

    const studentInfo = {
        seatNo: Number($("td:contains('Seat No')").next().text().trim()) || null,
        spId: Number($("td:contains('SP ID')").next().text().trim()) || null,
        enrolment: $("td:contains('Enrolment / PG Registration No')").next().text().trim(),
        collegeName: $("td:contains('College Name')").next().text().trim(),
        studentName: $("td:contains('Student Name')").next().text().trim(),
        examName: $("td:contains('Exam Name')").next().text().trim(),
    };

    const allEmpty = Object.values(studentInfo).every(v => !v);

    const semester = { totalMarks: null, marks: [] };
    const headers = [];

    $("#mytbl tr").first().find("td").each((_, c) => headers.push($(c).text().trim()));

    $("#mytbl tr").slice(1).each((_, row) => {
        const tds = $(row).find("td");
        const record = {};

        tds.each((idx, col) => {
            const key = headers[idx] || `col${idx}`;
            const val = $(col).text().trim();

            if (
                val &&
                !key.toLowerCase().includes("pass") &&
                !key.toLowerCase().includes("gp") &&
                !key.toLowerCase().includes("gl") &&
                !key.toLowerCase().includes("total") &&
                !key.toLowerCase().includes("credit")
            ) {
                record[key] = isNaN(Number(val)) ? val : Number(val);
            }
        });

        if (Object.keys(record).length) semester.marks.push(record);
    });

    const totalText = $("td:contains('Total Marks')").text();
    const match = totalText.match(/\/\s*(\d+)/);
    semester.totalMarks = match ? Number(match[1]) : null;

    return { studentInfo, semester, allEmpty };
}

// ---------------- SAFE NDJSON WRITE ----------------
function saveNDJSON(filename, data) {
    const folderPath = path.join(__dirname, "result"); // folder name
    const file = path.join(folderPath, filename + ".ndjson");
    fs.appendFileSync(file, JSON.stringify(data) + "\n");
}

// ---------------- PROCESS SINGLE URL ----------------
async function processURL(i, j) {
    const url = `https://ums.sgguerp.in/Result/StudentResultDisplay.aspx?HtmlURL=${i},${j}`;
    try {
        const html = await fetchHtml(url);
        if (!html || html.includes("Result Not Found!")) return false;


        const parsed = parseHtml(html);
        if (parsed.allEmpty) return false;

        saveNDJSON(`${i}`, parsed);
        return true;
    } catch (err) {
        console.error(`Error ${i},${j}:`, err);
        return false;
    }
}

// ---------------- BATCH WITH LIMITED CONCURRENCY ----------------
async function processBatch(i, startJ, batchSize = 20, concurrency = 5) {
    const results = [];
    const queue = Array.from({ length: batchSize }, (_, k) => startJ + k);

    while (queue.length) {
        const chunk = queue.splice(0, concurrency);
        const promises = chunk.map(j => processURL(i, j));
        const res = await Promise.all(promises);
        results.push(...res);
    }

    return results.filter(x => x).length; // number of saved results
}

// ---------------- MAIN LOOP ----------------
async function main() {
    let i = 293;
    let j = 1;

    // 🔹 existing files (without extension) ko SET me store karo
    const files = fs.readdirSync(path.join(__dirname, "result"));
    const existingFiles = new Set(
        files.map(file => Number(path.parse(file).name))
    );

    while (true) {

        // ✅ Agar file already exist hai → skip
        if (existingFiles.has(i)) {
            console.log("=======================================");
            console.log(`File for i=${i} already exists, skipping...`);
            console.log("=======================================");

            i++;
            j = 1;
            continue;
        }

        console.log(`Processing batch i=${i}, j=${j}...`);
        const savedCount = await processBatch(i, j, 20, 5);
        console.log(`Saved ${savedCount} results in this batch.`);

        // 🔁 Agar data kam mila → next i
        if (savedCount < 10) {
            i++;
            j = 1;
            console.log(`Moving to next i=${i}...`);
        } else {
            j += 20;
        }
        await new Promise(res => setTimeout(res, 300));
    }
}


// ---------------- START ----------------
main();
