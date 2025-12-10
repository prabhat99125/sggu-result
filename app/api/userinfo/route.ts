// app/api/userinfo/route.ts
import { NextResponse } from "next/server";
import fetchCookie from "fetch-cookie";
import { CookieJar } from "tough-cookie";
import * as cheerio from "cheerio";
import https from "https";
import result from '@/result/3.json'
const LOGIN_URL = "https://sgguerp.in";
const DASHBOARD_URL =
    "https://department.sgguerp.in/DepartmentDashboards/StudentDashboard.aspx";

// Allow self-signed certificates
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

export async function POST() {
    try {
        const shorted = result.sort((a, b) => a.studentInfo.seatNo - b.studentInfo.seatNo)
        shorted.forEach((item) => {
            console.log(item.studentInfo.seatNo);
        })
        // --- Your login credentials ---
        const username = "2024001508";
        const password = "123456789";

        const jar = new CookieJar();
        const fetchWithCookies = fetchCookie(fetch, jar);

        // -------------------------------
        // STEP 1: GET LOGIN PAGE
        // -------------------------------
        const pageRes = await fetchWithCookies(LOGIN_URL, {
            agent: httpsAgent,
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
            },
        });

        const html = await pageRes.text();
        const $ = cheerio.load(html);

        const VIEWSTATE = $("#__VIEWSTATE").val() || "";
        const EVENTVALIDATION = $("#__EVENTVALIDATION").val() || "";
        const VIEWSTATEGEN = $("#__VIEWSTATEGENERATOR").val() || "";

        // -------------------------------
        // STEP 2: LOGIN POST REQUEST
        // -------------------------------
        const form = new URLSearchParams();
        form.append("__LASTFOCUS", "");
        form.append("__EVENTTARGET", "");
        form.append("__EVENTARGUMENT", "");
        form.append("__VIEWSTATE", VIEWSTATE);
        form.append("__EVENTVALIDATION", EVENTVALIDATION);
        form.append("__VIEWSTATEGENERATOR", VIEWSTATEGEN);
        form.append("UserName", username);
        form.append("Password", password);
        form.append("btnLogin", "Login");

        const loginRes = await fetchWithCookies(LOGIN_URL, {
            method: "POST",
            body: form,
            agent: httpsAgent,
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
                Origin: LOGIN_URL,
                Referer: LOGIN_URL,
            },
            redirect: "follow",
        });

        if (!loginRes.ok) {
            throw new Error(`Login failed with status ${loginRes.status}`);
        }

        // -------------------------------
        // STEP 3: FETCH STUDENT DASHBOARD
        // -------------------------------
        const dashRes = await fetchWithCookies(DASHBOARD_URL, {
            method: "GET",
            agent: httpsAgent,
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
                Referer: LOGIN_URL,
            },
        });

        const dashboardHtml = await dashRes.text();
        const $dash = cheerio.load(dashboardHtml);

        // -------------------------------
        // STEP 4: EXTRACT STUDENT INFO
        // -------------------------------
        const studentInfo = {
            studentId: Number($dash("#ContentPlaceHolder1_lblSPDId").text().trim()),
            mobileNo: Number($dash("#ContentPlaceHolder1_lblMobileNo").text().trim()),
            email: $dash("#ContentPlaceHolder1_lblEmailId").text().trim(),
            gender: $dash("#ContentPlaceHolder1_lblGender").text().trim(),
            category: $dash("#ContentPlaceHolder1_lblCategory").text().trim(),
            currentAddress: $dash("#ContentPlaceHolder1_lblAddress").text().trim(),
            imageSrc: $dash("#ContentPlaceHolder1_img").attr("src") || "",
        };

        // -------------------------------
        // STEP 5: RETURN JSON RESPONSE
        // -------------------------------
        return NextResponse.json({
            ok: true,
            loginStatus: loginRes.status,
            dashboardStatus: dashRes.status,
            username,
            studentInfo,
        });
    } catch (err: any) {
        return NextResponse.json(
            { ok: false, error: err.message, stack: err.stack },
            { status: 500 }
        );
    }
}
