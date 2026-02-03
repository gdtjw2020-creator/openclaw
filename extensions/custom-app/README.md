# Custom App Channel Plugin

自定义移动APP channel插件，通过WebSocket实现实时双向通信。

## 功能特性

- ✅ WebSocket实时通信
- ✅ 消息持久化（SQLite）
- ✅ 离线消息队列
- ✅ 扫码注册（类似WhatsApp）
- ✅ Token认证
- ✅ 自动重连支持

## 配置

在 `~/.openclaw/config.json` 中添加：

```json
{
  "channels": {
    "custom-app": {
      "enabled": true,
      "port": 18800,
      "httpPort": 18801
    }
  }
}
```

## 使用方法

### 1. 启动Gateway

```bash
openclaw gateway run
```

### 2. 注册设备

访问注册页面：
```
http://localhost:18801/register
```

使用手机APP扫描二维码即可完成注册。

### 3. 消息通信

- **发送消息**：APP → OpenClaw
- **接收消息**：OpenClaw → APP
- **离线消息**：自动存储，重连后同步

## 消息格式

### 下行消息（OpenClaw → APP）

```json
{
  "type": "text",
  "text": "Hello from OpenClaw",
  "timestamp": 1738569600000,
  "messageId": "123"
}
```

```json
{
  "type": "media",
  "text": "Check this image",
  "mediaUrl": "https://example.com/image.jpg",
  "timestamp": 1738569600000,
  "messageId": "124"
}
```

### 上行消息（APP → OpenClaw）

```json
{
  "type": "text",
  "text": "Hello from APP",
  "timestamp": 1738569600000
}
```

### 同步消息

```json
{
  "type": "sync",
  "messages": [
    { "type": "text", "text": "Message 1", "messageId": "123" },
    { "type": "text", "text": "Message 2", "messageId": "124" }
  ]
}
```

### 确认消息

```json
{
  "type": "ack",
  "messageIds": ["123", "124"]
}
```

## 数据库

消息存储在 `~/.openclaw/custom-app.db`：

- `messages` 表：消息队列
- `devices` 表：已注册设备

## 端口

- **18800**：WebSocket服务器
- **18801**：HTTP注册服务器

## 安全

- 临时Token：5分钟过期（仅用于注册）
- 永久Token：永不过期（除非主动退出）
- Token存储：SHA-256加密

## 开发

### 依赖

```bash
pnpm install
```

### 构建

```bash
pnpm build
```

### 测试

```bash
# 启动服务器
openclaw gateway run

# 访问注册页面
open http://localhost:18801/register
```

## Android APP

参考 `mydoc/custom-app-channel-design.md` 中的Android实现指南。

## 故障排除

### WebSocket连接失败

检查防火墙是否开放18800端口：

```bash
# Linux
sudo ufw allow 18800

# AWS Security Group
添加入站规则：TCP 18800 0.0.0.0/0
```

### 消息未送达

检查数据库中的未送达消息：

```bash
sqlite3 ~/.openclaw/custom-app.db "SELECT * FROM messages WHERE delivered = 0"
```

### 设备无法注册

检查HTTP服务器日志：

```bash
openclaw gateway run --verbose
```

## License

MIT
