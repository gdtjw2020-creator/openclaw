import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import type { CustomAppWebSocketServer } from "./server.js";
import type { ChannelLogSink } from "openclaw/plugin-sdk";

export function startHttpServer(
  port: number,
  wsServer: CustomAppWebSocketServer,
  hostname: string,
  log?: ChannelLogSink
): void {
  const app = express();

  // 媒体文件存储目录
  const dataDir = process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw");
  const mediaDir = path.join(dataDir, "custom-app", "media");
  
  // 确保目录存在
  if (!fs.existsSync(mediaDir)) {
    fs.mkdirSync(mediaDir, { recursive: true });
  }

  // 配置 multer 文件上传
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, mediaDir);
    },
    filename: (_req, file, cb) => {
      // 生成唯一文件名: timestamp_random.ext
      const ext = path.extname(file.originalname) || getExtFromMime(file.mimetype);
      const uniqueName = `${Date.now()}_${crypto.randomBytes(8).toString("hex")}${ext}`;
      cb(null, uniqueName);
    },
  });

  const upload = multer({
    storage,
    limits: {
      fileSize: 100 * 1024 * 1024, // 100MB 限制
    },
  });

  // 文件上传接口
  app.post("/upload", upload.single("file"), (req, res) => {
    if (!req.file) {
      res.status(400).json({ success: false, error: "No file uploaded" });
      return;
    }

    const fileUrl = `http://${hostname}:${port}/media/${req.file.filename}`;
    
    log?.info(`File uploaded: ${req.file.originalname} -> ${req.file.filename}`);

    res.json({
      success: true,
      url: fileUrl,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mimeType: req.file.mimetype,
    });
  });

  // 静态文件服务 - 提供媒体文件访问
  app.use("/media", express.static(mediaDir));

  app.get("/register", async (req, res) => {
    const { tempToken, expires } = wsServer.createTempToken();

    const qrData = JSON.stringify({
      server: `ws://${hostname}:${port - 1}`,
      tempToken,
      expires,
    });

    // Generate QR code (using data URL for simplicity)
    const qrCodeDataUrl = await generateQRCode(qrData);

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>OpenClaw - 扫码连接</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          }
          .container {
            background: white;
            padding: 40px;
            border-radius: 20px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            text-align: center;
            max-width: 500px;
          }
          h1 {
            color: #333;
            margin-bottom: 10px;
            font-size: 32px;
          }
          .subtitle {
            color: #666;
            margin-bottom: 30px;
            font-size: 16px;
          }
          .qr-code {
            margin: 20px 0;
            padding: 20px;
            background: #f9f9f9;
            border-radius: 10px;
          }
          .qr-code img {
            max-width: 100%;
            height: auto;
          }
          .status {
            margin-top: 20px;
            padding: 15px;
            border-radius: 8px;
            font-weight: 600;
            font-size: 16px;
          }
          .waiting {
            background: #fff3cd;
            color: #856404;
          }
          .success {
            background: #d4edda;
            color: #155724;
          }
          .steps {
            text-align: left;
            margin-top: 30px;
            padding: 20px;
            background: #f5f5f5;
            border-radius: 10px;
          }
          .steps strong {
            display: block;
            margin-bottom: 10px;
            color: #333;
          }
          .steps ol {
            margin: 0;
            padding-left: 20px;
          }
          .steps li {
            margin: 8px 0;
            color: #555;
            line-height: 1.5;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>📱 OpenClaw</h1>
          <p class="subtitle">使用手机APP扫描二维码连接</p>
          
          <div class="qr-code">
            <img src="${qrCodeDataUrl}" alt="QR Code" />
          </div>
          
          <div id="status" class="status waiting">
            ⏳ 等待扫描...
          </div>
          
          <div class="steps">
            <strong>使用步骤：</strong>
            <ol>
              <li>打开OpenClaw手机APP</li>
              <li>点击"扫码连接"按钮</li>
              <li>扫描上方二维码</li>
              <li>等待连接成功</li>
            </ol>
          </div>
        </div>
        
        <script>
          const tempToken = "${tempToken}";
          const checkInterval = setInterval(async () => {
            try {
              const response = await fetch("/register/status?token=" + tempToken);
              const data = await response.json();
              
              if (data.connected) {
                document.getElementById("status").className = "status success";
                document.getElementById("status").textContent = "✅ 连接成功！";
                clearInterval(checkInterval);
              }
            } catch (e) {
              console.error("Failed to check status:", e);
            }
          }, 2000);
          
          setTimeout(() => {
            clearInterval(checkInterval);
            const statusEl = document.getElementById("status");
            if (statusEl.className.includes("waiting")) {
              statusEl.textContent = "⏱️ 二维码已过期，请刷新页面";
            }
          }, 5 * 60 * 1000);
        </script>
      </body>
      </html>
    `);
  });

  app.get("/register/status", (req, res) => {
    const tempToken = req.query.token as string;
    const connected = wsServer.isDeviceConnected(tempToken);

    res.json({ connected });
  });

  app.listen(port, () => {
    log?.info(
      `Custom App HTTP server started on port ${port}`
    );
    log?.info(
      `Registration page: http://${hostname}:${port}/register`
    );
  });
}

async function generateQRCode(data: string): Promise<string> {
  // Simple QR code generation using a data URL
  // In production, use a proper QR code library like 'qrcode'
  try {
    const QRCode = await import("qrcode");
    return await QRCode.toDataURL(data, {
      width: 300,
      margin: 2,
      color: {
        dark: "#000000",
        light: "#FFFFFF",
      },
    });
  } catch (error) {
    // Fallback: return a placeholder
    log?.warn(
      "QRCode library not available, using placeholder"
    );
    return "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMzAwIiBoZWlnaHQ9IjMwMCIgZmlsbD0iI2YwZjBmMCIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LXNpemU9IjE2IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkeT0iLjNlbSI+UVIgQ29kZSBQbGFjZWhvbGRlcjwvdGV4dD48L3N2Zz4=";
  }
}


// 根据 MIME 类型获取文件扩展名
function getExtFromMime(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "application/pdf": ".pdf",
    "application/zip": ".zip",
    "text/plain": ".txt",
  };
  return mimeToExt[mimeType] || "";
}
