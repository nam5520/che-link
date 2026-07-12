const { createClient } = require("@libsql/client");
const http = require("http");

const PORT = process.env.PORT || 3000;

// Local SQLite khi dev, Turso khi production
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "file:links.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const HTML = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<title>Che Link</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#f5f5f5;padding:2rem;color:#222}
  h1{font-size:1.4rem;margin-bottom:1.5rem;color:#111}
  form{display:flex;gap:.5rem;margin-bottom:2rem;flex-wrap:wrap}
  input{padding:.5rem .75rem;border:1px solid #ccc;border-radius:6px;font-size:.95rem;flex:1;min-width:160px}
  button{padding:.5rem 1.2rem;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:.95rem}
  button:hover{background:#1d4ed8}
  table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08)}
  th,td{padding:.6rem 1rem;text-align:left;font-size:.9rem;border-bottom:1px solid #eee}
  th{background:#f0f0f0;font-weight:600;color:#555}
  td a{color:#2563eb;text-decoration:none;word-break:break-all}
  td a:hover{text-decoration:underline}
  #msg{padding:.5rem .75rem;border-radius:6px;font-size:.9rem;display:none;margin-bottom:1rem}
  .ok{background:#dcfce7;color:#166534} .err{background:#fee2e2;color:#991b1b}
</style>
</head>
<body>
<h1>🔗 Che Link</h1>
<form id="f">
  <input id="slug" placeholder="slug (vd: anime)" required>
  <input id="url" placeholder="https://destination.com/..." required type="url">
  <button type="submit">Lưu</button>
</form>
<div id="msg"></div>
<div id="list"></div>
<script>
async function load(){
  const r=await fetch('/--list');
  const d=await r.json();
  const t=document.getElementById('list');
  if(!d.length){t.innerHTML='<p style="color:#888;font-size:.9rem">Chưa có link nào.</p>';return}
  t.innerHTML='<table><thead><tr><th>Slug</th><th>URL đích</th></tr></thead><tbody>'+
    d.map(x=>'<tr><td><a href="/'+x.slug+'" target="_blank">/'+x.slug+'</a></td><td><a href="'+x.url+'" target="_blank">'+x.url+'</a></td></tr>').join('')+
  '</tbody></table>';
}
document.getElementById('f').addEventListener('submit',async e=>{
  e.preventDefault();
  const msg=document.getElementById('msg');
  const s=document.getElementById('slug').value.trim();
  const u=document.getElementById('url').value.trim();
  const r=await fetch('/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug:s,url:u})});
  const d=await r.json();
  msg.style.display='block';
  if(d.ok){msg.className='ok';msg.textContent='✓ Đã lưu: /'+s+' → '+u;e.target.reset();load();}
  else{msg.className='err';msg.textContent='Lỗi!';}
});
load();
</script>
</body>
</html>`;

async function handle(req, res) {
  const { pathname } = new URL(req.url, "http://x");
  const slug = pathname.slice(1);

  // GET / → trang quản lý
  if (req.method === "GET" && slug === "") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(HTML);
  }

  // GET /--list → danh sách JSON
  if (req.method === "GET" && slug === "--list") {
    const { rows } = await db.execute("SELECT slug, destination_url FROM links ORDER BY slug");
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(rows.map(r => ({ slug: r.slug, url: r.destination_url }))));
  }

  // POST /add
  if (req.method === "POST" && slug === "add") {
    const body = await new Promise(r => { let d=""; req.on("data",c=>d+=c); req.on("end",()=>r(d)); });
    try {
      const { slug: s, url: u } = JSON.parse(body);
      if (!s || !u) { res.writeHead(400); return res.end("Missing slug or url"); }
      await db.execute({
        sql: `INSERT INTO links (slug, destination_url) VALUES (?, ?)
              ON CONFLICT(slug) DO UPDATE SET destination_url = excluded.destination_url`,
        args: [s, u]
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, slug: s, url: u }));
    } catch {
      res.writeHead(400); return res.end("Invalid JSON");
    }
  }

  // GET /:slug → redirect
  if (req.method === "GET" && slug) {
    const { rows } = await db.execute({ sql: "SELECT destination_url FROM links WHERE slug = ?", args: [slug] });
    if (rows[0]) {
      res.writeHead(302, { Location: rows[0].destination_url });
      return res.end();
    }
    res.writeHead(404); return res.end("Not found");
  }

  res.writeHead(404); res.end("Not found");
}

async function main() {
  await db.execute(`CREATE TABLE IF NOT EXISTS links (
    slug TEXT PRIMARY KEY,
    destination_url TEXT NOT NULL
  )`);
  http.createServer((req, res) => {
    handle(req, res).catch(e => { console.error(e); res.writeHead(500); res.end("Error"); });
  }).listen(PORT, () => console.log(`✓ Running → http://localhost:${PORT}`));
}

main();
