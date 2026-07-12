# che-link

Ứng dụng tối giản: lưu slug → redirect URL. **1 file, 0 dependency.**

## Yêu cầu

- Node.js >= 22.5 (có sẵn `node:sqlite` built-in)

## Chạy

```bash
node --experimental-sqlite server.js
# hoặc
npm start
```

Mặc định lắng nghe tại `http://localhost:3000`.  
Đổi port: `PORT=8080 node --experimental-sqlite server.js`

---

## Dùng

### Thêm / cập nhật link

```bash
curl -X POST http://localhost:3000/add \
  -H "Content-Type: application/json" \
  -d '{"slug":"anime","url":"https://example.com/very/long/link"}'
```

Phản hồi:
```json
{ "ok": true, "slug": "anime", "url": "https://example.com/very/long/link" }
```

> Nếu slug đã tồn tại → URL được cập nhật.

### Redirect

```
GET http://localhost:3000/anime
→ 302 Location: https://example.com/very/long/link
```

Mở trình duyệt hoặc dùng curl:
```bash
curl -L http://localhost:3000/anime
```

Nếu slug không tồn tại → **404 Not found**.

---

## Dữ liệu

Lưu trong file `links.db` (SQLite) cùng thư mục. Tự tạo khi khởi động lần đầu.
