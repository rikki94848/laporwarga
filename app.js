require("dotenv").config();

const express = require("express");
const mysql = require("mysql2");
const multer = require("multer");
const AWS = require("aws-sdk");
const path = require("path");
const cors = require("cors");

const app = express();

/* =========================
   MIDDLEWARE
========================= */

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, "public")));

/* =========================
   MULTER
========================= */

const upload = multer({
  storage: multer.memoryStorage(),
});

/* =========================
   MYSQL RDS
========================= */

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  connectTimeout: 10000,
});

db.connect((err) => {
  if (err) {
    console.log("⚠️ Database belum connect");
    console.log(err.code);
  } else {
    console.log("✅ Database connected");
  }
});

/* =========================
   AWS S3
========================= */

AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

const s3 = new AWS.S3();

/* =========================
   ROOT
========================= */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* =========================
   GET DATA
========================= */

app.get("/api/pengaduan", (req, res) => {
  // sementara dummy data dulu
  const data = [
    {
      id: 1,
      judul: "Jalan Rusak",
      deskripsi: "Ada jalan berlubang di depan sekolah",
      kategori: "Jalan Rusak",
      foto_url: "",
    },
  ];

  res.json(data);
});

/* =========================
   POST DATA
========================= */

app.post("/api/pengaduan", upload.single("foto"), async (req, res) => {
  try {
    console.log("📩 Pengaduan masuk");

    const { judul, deskripsi, kategori } = req.body;

    console.log("Judul:", judul);
    console.log("Deskripsi:", deskripsi);
    console.log("Kategori:", kategori);

    if (req.file) {
      console.log("📷 File diterima:", req.file.originalname);
    }

    // =========================
    // MODE DEMO SEMENTARA
    // =========================

    return res.status(200).json({
      success: true,
      message: "✅ Pengaduan berhasil dikirim",
    });
  } catch (error) {
    console.log(error);

    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

/* =========================
   SERVER
========================= */

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server jalan di port ${PORT}`);
});
