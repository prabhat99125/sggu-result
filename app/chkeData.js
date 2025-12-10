const fs = require("fs");
const path = require("path");

// Folder path
const folderPath = path.join(process.cwd(), "result");

function checkAllFiles() {
    const files = fs.readdirSync(folderPath);
    const jsonFiles = files.filter(file => file.endsWith(".json"));

    for (const file of jsonFiles) {
        const fullPath = path.join(folderPath, file);
        const data = JSON.parse(fs.readFileSync(fullPath, "utf8"));

        // Extract all seat numbers
        const seatNumbers = data.map(item => item.studentInfo.seatNo);

        const maxSeat = Math.max(...seatNumbers);
        let missing = [];

        // Missing seat numbers check
        for (let i = 1; i <= maxSeat; i++) {
            if (!seatNumbers.includes(i)) {
                missing.push(i);
            }
        }

        // Duplicate check
        let duplicates = seatNumbers.filter((num, idx) => seatNumbers.indexOf(num) !== idx);
        duplicates = [...new Set(duplicates)]; // Unique duplicates

        console.log(`📄 FILE: ${file}`);

        if (missing.length > 0) {
            console.log("❌ Missing Seats:", missing);
        } else {
            console.log("✔ No Missing Seats");
        }

        if (duplicates.length > 0) {
            console.log("⚠ Duplicate Seat Numbers:", duplicates);
        } else {
            console.log("✔ No Duplicate Seats");
        }

        console.log("--------------------------------");
    }
}

checkAllFiles();
