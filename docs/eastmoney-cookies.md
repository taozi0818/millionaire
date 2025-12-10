# 东方财富 Cookie 机制

## 必需 Cookie

以下 Cookie 是调用东方财富 API（如 `push2.eastmoney.com`）所必需的：

| Cookie | 必需 | 说明 |
|--------|------|------|
| `qgqp_b_id` | 是 | 用户标识符 |
| `nid18` | **是** | 设备指纹标识，缺失会导致请求被拒绝 |
| `nid18_create_time` | 否 | 创建时间戳 |
| `gviem` | 否 | 辅助设备标识 |
| `gviem_create_time` | 否 | 创建时间戳 |
| `st_nvi` | 否 | 会话标识符 |

> **重要**: `nid18` 是最关键的 Cookie，如果缺失，服务器会直接关闭连接（返回空响应）。

---

## Cookie 详情

### 1. qgqp_b_id

**用途**: 用户唯一标识符，用于追踪和统计

**来源**: 客户端 JavaScript 生成

**生成算法**:
```javascript
function generateQgqpBid() {
  // 第一位：1-9 的随机数字
  let id = Math.floor(9 * Math.random() + 1).toString();
  // 后19位：0-9 的随机数字
  for (let i = 0; i < 19; i++) {
    id += Math.floor(9 * Math.random()).toString();
  }
  return id;
}
```

**格式**: 20位数字字符串，首位为1-9，其余为0-9

**示例**: `7e5ec5863a12f2fe3ec6` (实际是20位数字，但也见过32位十六进制格式)

**有效期**: 10000天

**Domain**: `.eastmoney.com`

**来源文件**:
- `https://emcharts.dfcfw.com/emsider/prod/emsider.min.js`
- `https://emcharts.dfcfw.com/usercollect/usercollect.min.js`
- `https://emcharts.dfcfw.com/pr3/prod/personalrecommend3.min.js`

---

### 2. nid18

**用途**: 设备指纹标识符

**来源**: 服务器端生成，通过 API 返回

**获取方式**:
1. 收集设备指纹信息（浏览器、屏幕、语言、时区、Canvas、WebGL、字体、音频等）
2. 发送 POST 请求到 `https://anonflow2.eastmoney.com/backend/api/webreport`
3. 服务器返回 `nid` 和 `gvi`

**请求体格式**:
```json
{
  "osPlatform": "MacOS",
  "sourceType": "WEB",
  "osversion": "Mac OS X 10.15.7",
  "language": "zh-CN",
  "timezone": "Asia/Shanghai",
  "webDeviceInfo": {
    "screenResolution": "1920X1080",
    "userAgent": "Mozilla/5.0 ...",
    "canvasKey": "<hash>",
    "webglKey": "<hash>",
    "fontKey": "<hash>",
    "audioKey": "<hash>"
  }
}
```

**格式**: 32位十六进制字符串

**示例**: `02f71d48519e49e3ede7b2a858eca5c9`

**有效期**: 90天

**Domain**: `.eastmoney.com`

**来源文件**: `https://anonflow2.eastmoney.com/ewtsdk/ewtsdk.prod.js`

---

### 3. nid18_create_time

**用途**: 记录 nid18 的创建时间戳

**来源**: 客户端在收到 nid18 后设置

**格式**: Unix 毫秒时间戳

**示例**: `1764652571161`

**有效期**: 90天

**Domain**: `.eastmoney.com`

---

### 4. gviem

**用途**: 另一个设备标识符

**来源**: 与 nid18 一起由服务器返回

**格式**: 25位 nanoid 风格字符串

**字符集**: `useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict`

**示例**: `EiJGvc1SgoHwbwAP0PCeH6d6f`

**有效期**: 90天

**Domain**: `.eastmoney.com`

---

### 5. gviem_create_time

**用途**: 记录 gviem 的创建时间戳

**来源**: 客户端在收到 gviem 后设置

**格式**: Unix 毫秒时间戳

**有效期**: 90天

---

### 6. st_nvi (可选)

**用途**: 会话标识符

**来源**: 客户端生成

**生成算法**:
```javascript
function generateStNvi() {
  const alphabet = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
  const bytes = new Uint8Array(21);
  crypto.getRandomValues(bytes);
  let id = "";
  for (let i = 20; i >= 0; i--) {
    id += alphabet[bytes[i] & 63];
  }
  // 附加 SHA256 hash 的前4位
  const hash = sha256(id).slice(0, 4);
  return id + hash;
}
```

**有效期**: 365天