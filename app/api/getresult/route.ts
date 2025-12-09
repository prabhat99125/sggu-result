import { NextResponse } from "next/server";
import https from "https";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";

// --------------------- HTML FETCH WITH RETRY ---------------------
async function fetchHtml(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        https.get(url, { rejectUnauthorized: false }, (res) => {
            let html = "";
            res.on("data", (chunk) => (html += chunk));
            res.on("end", () => resolve(html));
            res.on("error", (err) => reject(err));
        });
    });
}

async function fetchHtmlWithRetry(url: string, retries = 3, delay = 1500): Promise<string> {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await fetchHtml(url);
        } catch (err: any) {
            if (attempt === retries) throw err;
            console.warn(`Retry ${attempt} for ${url} after error: ${err.message}`);
            await new Promise((res) => setTimeout(res, delay));
        }
    }
    return "";
}

// --------------------- PARSE HTML FUNCTION ---------------------
function parseHtml(html: string) {
    const $ = cheerio.load(html);

    let seatNo = $("td:contains('Seat No')").next().text().trim();
    let spId = $("td:contains('SP ID')").next().text().trim();

    const studentInfo: any = {
        seatNo: seatNo ? Number(seatNo) : null,
        spId: spId ? Number(spId) : null,
        enrolment: $("td:contains('Enrolment / PG Registration No')").next().text().trim(),
        collegeName: $("td:contains('College Name')").next().text().trim(),
        studentName: $("td:contains('Student Name')").next().text().trim(),
        examName: $("td:contains('Exam Name')").next().text().trim(),
    };

    const allEmpty = Object.values(studentInfo).every((v) => !v);

    const semester: any = { totalMarks: null, marks: [] };
    const headerCols: string[] = [];

    // Get header row
    $("#mytbl tr").first().find("td").each((_, col) => {
        headerCols.push($(col).text().trim());
    });

    // Process remaining rows
    $("#mytbl tr").slice(1).each((_, row) => {
        const cols = $(row).find("td");
        const subjectObj: any = {};

        cols.each((idx, col) => {
            const key = headerCols[idx] || `col${idx}`;
            const value = $(col).text().trim();

            if (
                value &&
                !key.toLowerCase().includes("pass") &&
                !key.toLowerCase().includes("total") &&
                !key.toLowerCase().includes("gl") &&
                !key.toLowerCase().includes("gp") &&
                !key.toLowerCase().includes("credit")
            ) {
                subjectObj[key] = isNaN(Number(value)) ? value : Number(value);
            }
        });

        if (Object.keys(subjectObj).length > 0) semester.marks.push(subjectObj);
    });

    const totalMarksText = $("td:contains('Total Marks')").text() || "";
    const match = totalMarksText.match(/\/\s*(\d+)/);
    semester.totalMarks = match ? Number(match[1]) : null;

    return { studentInfo, semester, allEmpty };
}

// --------------------- SAVE JSON WITH DYNAMIC SEM ---------------------
function saveJsonWithSem(newData: any) {
    const folderPath = path.join(process.cwd(), "bca");
    if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });

    const filePath = path.join(folderPath, "2023.json");

    let oldData: any[] = [];
    if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf8");
        if (content.trim() !== "") oldData = JSON.parse(content);
    }

    const { studentInfo, semester } = newData;
    if (!studentInfo.spId) return filePath;

    const index = oldData.findIndex((s) => s.spId === studentInfo.spId);

    if (index === -1) {
        // First time student
        oldData.push({ ...studentInfo, sem1: semester });
    } else {
        const student = oldData[index];
        let semNum = 1;

        // Find next available semester
        while (student[`sem${semNum}`]) {
            const oldMarks = JSON.stringify(student[`sem${semNum}`].marks);
            const newMarks = JSON.stringify(semester.marks);

            if (oldMarks === newMarks && student[`sem${semNum}`].totalMarks === semester.totalMarks) {
                return filePath; // Same semester, skip
            }
            semNum++;
        }

        student[`sem${semNum}`] = semester; // Add new semester
        oldData[index] = student;
    }

    fs.writeFileSync(filePath, JSON.stringify(oldData, null, 2), "utf8");
    return filePath;
}

// --------------------- HISTORY MANAGEMENT ---------------------
const historyFile = path.join(process.cwd(), "bca", "history.json");

function loadHistory(): { i: number; j: number } {
    if (fs.existsSync(historyFile)) {
        const content = fs.readFileSync(historyFile, "utf8");
        if (content.trim() !== "") return JSON.parse(content);
    }
    return { i: 1, j: 1 };
}

function saveHistory(i: number, j: number) {
    fs.writeFileSync(historyFile, JSON.stringify({ i, j }, null, 2), "utf8");
}

// --------------------- HANDLE UNCUGHT EXCEPTIONS ---------------------
process.on("uncaughtException", (err: any) => {
    if (err.code === "ECONNRESET") {
        console.warn("Connection reset by server, continuing...");
    } else {
        console.error("Unhandled exception:", err);
    }
});

// --------------------- MAIN API ROUTE ---------------------
export async function GET() {
    const finalResults: any[] = [];
    let stopLoop = 1;

    let { i: startI, j: startJ } = loadHistory();

    for (let i = startI; ; i++) {
        for (let j = i === startI ? startJ : 1; ; j++) {
            const url = `https://ums.sgguerp.in/Result/StudentResultDisplay.aspx?HtmlURL=${i},${j}`;

            try {
                const html = await fetchHtmlWithRetry(url, 3, 1500);

                if (html.includes("Result Not Found!") || html.trim() === "") {
                    stopLoop++;
                    finalResults.push({ url, status: "empty" });
                } else {
                    const parsed = parseHtml(html);

                    if (parsed.allEmpty) {
                        stopLoop++;
                        finalResults.push({ url, status: "empty" });
                    } else {
                        stopLoop = 1;
                        saveJsonWithSem(parsed); // auto sem increment
                        finalResults.push({
                            url,
                            status: "saved",
                            student: parsed.studentInfo.studentName || "Unknown",
                        });
                    }
                }

                saveHistory(i, j);
                await new Promise((res) => setTimeout(res, 500));

                if (stopLoop >= 10) break;
            } catch (err: any) {
                finalResults.push({ url, status: "failed", error: String(err) });
                saveHistory(i, j);
            }

            if (stopLoop >= 10) break;
        }

        if (stopLoop >= 10) {
            stopLoop = 1;
            continue;
        }
    }

    return NextResponse.json({
        success: true,
        message: "Loop completed with full resume & dynamic semester support!",
        processed: finalResults.length,
        file: "bca/2023.json",
    });
}
