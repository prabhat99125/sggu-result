import { NextResponse } from "next/server";
import https from "https";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";

// --------------------- FETCH HTML ---------------------
async function fetchHtml(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        https.get(url, { rejectUnauthorized: false }, (res) => {
            let html = "";
            res.on("data", chunk => html += chunk);
            res.on("end", () => resolve(html));
            res.on("error", err => reject(err));
        });
    });
}

async function fetchWithRetry(url: string, retry = 3): Promise<string> {
    for (let a = 1; a <= retry; a++) {
        try {
            return await fetchHtml(url);
        } catch (e: any) {
            if (a === retry) throw e;
            await new Promise(res => setTimeout(res, 1000));
        }
    }
    return "";
}

// --------------------- PARSE HTML ---------------------
function parseHtml(html: string) {
    const $ = cheerio.load(html);

    const studentInfo: any = {
        seatNo: Number($("td:contains('Seat No')").next().text().trim()) || null,
        spId: Number($("td:contains('SP ID')").next().text().trim()) || null,
        enrolment: $("td:contains('Enrolment / PG Registration No')").next().text().trim(),
        collegeName: $("td:contains('College Name')").next().text().trim(),
        studentName: $("td:contains('Student Name')").next().text().trim(),
        examName: $("td:contains('Exam Name')").next().text().trim(),
    };

    const allEmpty = Object.values(studentInfo).every(v => !v);

    const semester: any = { totalMarks: null, marks: [] };
    const headers: string[] = [];

    $("#mytbl tr").first().find("td").each((_, c) => {
        headers.push($(c).text().trim());
    });

    $("#mytbl tr").slice(1).each((_, row) => {
        const tds = $(row).find("td");
        const record: any = {};

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

// --------------------- SAVE JSON (i → filename) ---------------------
function saveJson(i: number, newData: any) {
    const folder = path.join(process.cwd(), "result");
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

    const file = path.join(folder, `${i}.json`);

    let old: any[] = [];
    if (fs.existsSync(file)) {
        const txt = fs.readFileSync(file, "utf8");
        if (txt.trim()) old = JSON.parse(txt);
    }

    // Append without checking anything
    old.push(newData);

    fs.writeFileSync(file, JSON.stringify(old, null, 2));
}

// --------------------- HISTORY ---------------------
const histFile = path.join(process.cwd(), "history.json");

function readHist() {
    if (fs.existsSync(histFile)) {
        return JSON.parse(fs.readFileSync(histFile, "utf8"));
    }
    return { i: 1, j: 1 };
}

function writeHist(i: number, j: number) {
    fs.writeFileSync(histFile, JSON.stringify({ i, j }, null, 2));
}

// --------------------- PROCESS BATCH ---------------------
async function processBatch(i: number, startJ: number, batchSize = 20) {
    const tasks = [];

    for (let j = startJ; j < startJ + batchSize; j++) {
        const url = `https://ums.sgguerp.in/Result/StudentResultDisplay.aspx?HtmlURL=${i},${j}`;
        tasks.push({ url, j });
    }

    let emptyCount = 0;

    const results = await Promise.all(
        tasks.map(async (item) => {
            try {
                const html = await fetchWithRetry(item.url);

                if (html.includes("Result Not Found!") || html.trim() === "") {
                    emptyCount++;
                    return { ...item, status: "empty" };
                }

                const parsed = parseHtml(html);

                if (parsed.allEmpty) {
                    emptyCount++;
                    return { ...item, status: "empty" };
                }

                // Save result to file named by current i
                saveJson(i, parsed);

                return { ...item, status: "saved" };

            } catch (e) {
                return { ...item, status: "error" };
            }
        })
    );

    const lastJ = startJ + batchSize - 1;
    writeHist(i, lastJ);

    return { results, emptyCount };
}

// --------------------- MAIN API ---------------------
export async function GET() {
    let { i, j } = readHist();
    const finalOutput: any[] = [];

    while (true) {
        const batch = await processBatch(i, j, 20);

        finalOutput.push(...batch.results);

        if (batch.emptyCount >= 10) {
            i++;
            j = 1;
        } else {
            j += 20;
        }

        await new Promise(res => setTimeout(res, 300));
    }

    return NextResponse.json({
        success: true,
        message: "Scraper running!",
        processed: finalOutput.length
    });
}
