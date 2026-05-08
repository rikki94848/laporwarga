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

  limits: {
    fileSize: 50 * 1024 * 1024,
  },
});

/* =========================
   MYSQL RDS
========================= */

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  connectTimeout: 10000,
});

db.connect((err) => {
  if (err) {
    console.log("❌ Database gagal connect");
    console.log(err);
  } else {
    console.log("✅ Database connected");

    /* =========================
       CREATE DATABASE
    ========================= */

    db.query(`CREATE DATABASE IF NOT EXISTS laporwarga`, (err) => {
      if (err) {
        console.log("❌ Gagal create database");
        console.log(err);
      } else {
        console.log("✅ Database laporwarga siap");

        /* =========================
           USE DATABASE
        ========================= */

        db.changeUser(
          {
            database: "laporwarga",
          },
          (err) => {
            if (err) {
              console.log("❌ Gagal gunakan database");
              console.log(err);
            } else {
              console.log("✅ Menggunakan database laporwarga");

              /* =========================
                 CREATE TABLE
              ========================= */

              const createTable = `
                CREATE TABLE IF NOT EXISTS pengaduan (
                  id INT AUTO_INCREMENT PRIMARY KEY,
                  judul VARCHAR(255),
                  deskripsi TEXT,
                  kategori VARCHAR(100),
                  lokasi VARCHAR(255),
                  foto_url TEXT,
                  file_type VARCHAR(100),
                  status_pengaduan VARCHAR(50) DEFAULT 'Pending',
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
              `;

              db.query(createTable, (err) => {
                if (err) {
                  console.log("❌ Gagal create table");
                  console.log(err);
                } else {
                  console.log("✅ Table pengaduan siap");

                  /* =========================
                     ALTER TABLE
                  ========================= */

                  const alterQueries = [
                    `
                    ALTER TABLE pengaduan
                    ADD COLUMN lokasi VARCHAR(255)
                    `,
                    `
                    ALTER TABLE pengaduan
                    ADD COLUMN file_type VARCHAR(100)
                    `,
                    `
                    ALTER TABLE pengaduan
                    ADD COLUMN status_pengaduan VARCHAR(50)
                    DEFAULT 'Pending'
                    `,
                  ];

                  alterQueries.forEach((query) => {
                    db.query(query, (err) => {
                      if (err) {
                        console.log("ℹ️ Kolom mungkin sudah ada");
                      }
                    });
                  });
                }
              });
            }
          },
        );
      }
    });
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
   HEALTH CHECK
========================= */

app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Server running",
    timestamp: new Date(),
  });
});

/* =========================
   GET DATA
========================= */

app.get("/api/pengaduan", (req, res) => {
  const { kategori, search } = req.query;

  let sql = `
    SELECT * FROM pengaduan
    WHERE 1=1
  `;

  const values = [];

  /* =========================
     FILTER KATEGORI
  ========================= */

  if (kategori && kategori !== "Semua") {
    sql += ` AND kategori = ?`;

    values.push(kategori);
  }

  /* =========================
     SEARCH
  ========================= */

  if (search) {
    sql += `
      AND (
        judul LIKE ?
        OR deskripsi LIKE ?
      )
    `;

    values.push(`%${search}%`);
    values.push(`%${search}%`);
  }

  sql += ` ORDER BY created_at DESC`;

  db.query(sql, values, (err, result) => {
    if (err) {
      console.log(err);

      return res.status(500).json({
        success: false,
        message: "Gagal mengambil data",
      });
    }

    return res.json(result);
  });
});

/* =========================
   STATS
========================= */

app.get("/api/stats", (req, res) => {
  const sql = `
    SELECT
      COUNT(*) as total,

      SUM(
        CASE
          WHEN status_pengaduan='Pending'
          THEN 1
          ELSE 0
        END
      ) as pending,

      COUNT(DISTINCT kategori) as kategori

    FROM pengaduan
  `;

  db.query(sql, (err, result) => {
    if (err) {
      return res.status(500).json(err);
    }

    res.json(result[0]);
  });
});

/* =========================
   DEBUG DATABASE
========================= */

app.get("/api/debug", (req, res) => {
  const sql = `
    SELECT * FROM pengaduan
    ORDER BY created_at DESC
  `;

  db.query(sql, (err, result) => {
    if (err) {
      console.log(err);

      return res.status(500).json({
        success: false,
        error: err,
      });
    }

    return res.json({
      success: true,
      total_data: result.length,
      data: result,
    });
  });
});

/* =========================
   POST DATA
========================= */

app.post("/api/pengaduan", upload.single("file"), async (req, res) => {
  try {
    console.log("📩 Pengaduan masuk");

    const { judul, deskripsi, kategori, lokasi } = req.body;

    /* =========================
         VALIDASI INPUT
      ========================= */

    if (!judul || !deskripsi || !kategori) {
      return res.status(400).json({
        success: false,
        message: "Field wajib belum lengkap",
      });
    }

    let fotoUrl = "";
    let fileType = "";

    /* =========================
         UPLOAD FILE KE S3
      ========================= */

    if (req.file) {
      console.log("📷 Upload file ke S3");

      const fileName = Date.now() + "-" + req.file.originalname;

      const params = {
        Bucket: process.env.S3_BUCKET,
        Key: fileName,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
        ContentDisposition: "attachment",
      };

      const uploadResult = await s3.upload(params).promise();

      /* =========================
           CLOUD FRONT URL
        ========================= */

      const cloudfrontDomain =
        process.env.CLOUDFRONT_URL || uploadResult.Location;

      fotoUrl = uploadResult.Location.replace(
        `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com`,
        cloudfrontDomain,
      );

      fileType = req.file.mimetype;

      console.log("✅ Upload berhasil");
      console.log(fotoUrl);
    }

    /* =========================
         SIMPAN DATABASE
      ========================= */

    const sql = `
        INSERT INTO pengaduan
        (
          judul,
          deskripsi,
          kategori,
          lokasi,
          foto_url,
          file_type,
          status_pengaduan
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;

    db.query(
      sql,
      [
        judul,
        deskripsi,
        kategori,
        lokasi || null,
        fotoUrl,
        fileType,
        "Pending",
      ],
      (err, result) => {
        if (err) {
          console.log(err);

          return res.status(500).json({
            success: false,
            message: "Gagal simpan pengaduan",
          });
        }

        return res.status(200).json({
          success: true,
          message: "✅ Pengaduan berhasil dikirim",

          data: {
            judul,
            kategori,
            lokasi,
            foto_url: fotoUrl,
            file_type: fileType,
          },
        });
      },
    );
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
