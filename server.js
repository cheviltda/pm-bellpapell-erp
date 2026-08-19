const express=require("express");
const bcrypt=require("bcryptjs");
const jwt=require("jsonwebtoken");
const {Pool}=require("pg");
const path=require("path");

const app=express(), PORT=process.env.PORT||3000;
const SECRET=process.env.JWT_SECRET||"TROQUE-ESTA-CHAVE-V5";
const pool=new Pool({connectionString:process.env.DATABASE_URL||"postgresql://postgres:postgres@localhost:5432/pm_bellpapell"});
app.use(express.json({limit:"3mb"}));
app.use(express.static(path.join(__dirname,"public")));

async function q(sql,params=[]){return (await pool.query(sql,params)).rows}
async function init(){
 await pool.query(`
 CREATE TABLE IF NOT EXISTS users(id SERIAL PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'operador',created_at TIMESTAMPTZ DEFAULT now());
 CREATE TABLE IF NOT EXISTS clients(id SERIAL PRIMARY KEY,name TEXT NOT NULL,phone TEXT,cpf TEXT,email TEXT,notes TEXT,created_at TIMESTAMPTZ DEFAULT now());
 ALTER TABLE clients ADD COLUMN IF NOT EXISTS address TEXT;
 CREATE TABLE IF NOT EXISTS items(id SERIAL PRIMARY KEY,name TEXT NOT NULL,quantity INT NOT NULL DEFAULT 0,notes TEXT);
 CREATE TABLE IF NOT EXISTS kits(id SERIAL PRIMARY KEY,name TEXT NOT NULL,price NUMERIC(12,2) NOT NULL DEFAULT 0,active BOOLEAN DEFAULT true);
 CREATE TABLE IF NOT EXISTS kit_parts(id SERIAL PRIMARY KEY,kit_id INT REFERENCES kits(id) ON DELETE CASCADE,item_id INT REFERENCES items(id),quantity INT NOT NULL);
 CREATE TABLE IF NOT EXISTS reservations(id SERIAL PRIMARY KEY,client_id INT REFERENCES clients(id),kit_id INT REFERENCES kits(id),event_date DATE NOT NULL,value NUMERIC(12,2) NOT NULL,paid NUMERIC(12,2) DEFAULT 0,pickup TEXT,return_time TEXT,notes TEXT,status TEXT DEFAULT 'Confirmada',contract_status TEXT DEFAULT 'Pendente',created_by INT REFERENCES users(id),created_at TIMESTAMPTZ DEFAULT now());
 CREATE TABLE IF NOT EXISTS payments(id SERIAL PRIMARY KEY,reservation_id INT REFERENCES reservations(id) ON DELETE CASCADE,amount NUMERIC(12,2) NOT NULL,method TEXT,paid_at DATE DEFAULT CURRENT_DATE,note TEXT);
 CREATE INDEX IF NOT EXISTS reservations_date_idx ON reservations(event_date);
 `);
 const u=await q("SELECT count(*)::int n FROM users");
 if(!u[0].n){
   const hash=bcrypt.hashSync("troque123",10);
   await q("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4)",["P&M Bellpapell","admin@bellpapell.local",hash,"admin"]);
 }
}
function auth(req,res,next){const h=req.headers.authorization||"";if(!h.startsWith("Bearer "))return res.status(401).json({error:"Não autenticado"});try{req.user=jwt.verify(h.slice(7),SECRET);next()}catch(e){res.status(401).json({error:"Sessão expirada"})}}
function admin(req,res,next){if(req.user.role!=="admin")return res.status(403).json({error:"Acesso restrito ao administrador"});next()}
async function reserved(itemId,date,ignoreId=null){
 const r=await q(`SELECT COALESCE(SUM(kp.quantity),0)::int used FROM reservations r JOIN kit_parts kp ON kp.kit_id=r.kit_id WHERE kp.item_id=$1 AND r.event_date=$2 AND r.status<>'Cancelada' ${ignoreId?"AND r.id<>$3":""}`,ignoreId?[itemId,date,ignoreId]:[itemId,date]);
 const item=await q("SELECT quantity FROM items WHERE id=$1",[itemId]);return (item[0]?.quantity||0)-r[0].used;
}
async function conflicts(kitId,date,ignoreId=null){
 const parts=await q("SELECT kp.item_id,kp.quantity,i.name FROM kit_parts kp JOIN items i ON i.id=kp.item_id WHERE kp.kit_id=$1",[kitId]);
 const out=[];for(const p of parts){const av=await reserved(p.item_id,date,ignoreId);if(av<p.quantity)out.push({item:p.name,required:p.quantity,available:av})}return out;
}
app.post("/api/login",async(req,res)=>{try{const {email,password}=req.body||{},u=(await q("SELECT * FROM users WHERE email=$1",[email||""]))[0];if(!u||!bcrypt.compareSync(password||"",u.password_hash))return res.status(401).json({error:"E-mail ou senha inválidos"});const token=jwt.sign({id:u.id,name:u.name,email:u.email,role:u.role},SECRET,{expiresIn:"7d"});res.json({token,user:{id:u.id,name:u.name,email:u.email,role:u.role}})}catch(e){res.status(500).json({error:e.message})}});
app.get("/api/me",auth,(req,res)=>res.json({user:req.user}));

app.get("/api/dashboard",auth,async(req,res)=>{const [a,b,c,m]=await Promise.all([q("SELECT count(*)::int n FROM reservations WHERE status<>'Cancelada'"),q("SELECT count(*)::int n FROM clients"),q("SELECT count(*)::int n FROM items"),q("SELECT COALESCE(sum(value),0) total,COALESCE(sum(paid),0) paid FROM reservations WHERE status<>'Cancelada'")]);res.json({reservations:a[0].n,clients:b[0].n,items:c[0].n,total:Number(m[0].total),paid:Number(m[0].paid),due:Number(m[0].total)-Number(m[0].paid),user:req.user})});

app.get("/api/clients",auth,async(req,res)=>res.json(await q("SELECT * FROM clients ORDER BY name")));
app.post("/api/clients",auth,async(req,res)=>{const x=req.body;if(!x.name)return res.status(400).json({error:"Nome obrigatório"});const r=await q("INSERT INTO clients(name,phone,cpf,address,email,notes) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",[x.name,x.phone||"",x.cpf||"",x.address||"",x.email||"",x.notes||""]);res.json(r[0])});
app.put("/api/clients/:id",auth,async(req,res)=>{const x=req.body;await q("UPDATE clients SET name=$1,phone=$2,cpf=$3,address=$4,email=$5,notes=$6 WHERE id=$7",[x.name,x.phone||"",x.cpf||"",x.address||"",x.email||"",x.notes||"",req.params.id]);res.json({ok:true})});
app.delete("/api/clients/:id",auth,async(req,res)=>{try{await q("DELETE FROM clients WHERE id=$1",[req.params.id]);res.json({ok:true})}catch(e){res.status(400).json({error:"Cliente possui reservas vinculadas"})}});

app.get("/api/items",auth,async(req,res)=>{const items=await q("SELECT * FROM items ORDER BY name");const today=new Date().toISOString().slice(0,10);for(const i of items)i.availableToday=await reserved(i.id,today);res.json(items)});
app.post("/api/items",auth,async(req,res)=>{const x=req.body;if(!x.name||+x.quantity<1)return res.status(400).json({error:"Nome e quantidade obrigatórios"});const r=await q("INSERT INTO items(name,quantity,notes) VALUES($1,$2,$3) RETURNING id",[x.name,+x.quantity,x.notes||""]);res.json(r[0])});
app.put("/api/items/:id",auth,async(req,res)=>{const x=req.body;await q("UPDATE items SET name=$1,quantity=$2,notes=$3 WHERE id=$4",[x.name,+x.quantity,x.notes||"",req.params.id]);res.json({ok:true})});

app.get("/api/kits",auth,async(req,res)=>{const kits=await q("SELECT * FROM kits WHERE active=true ORDER BY name");for(const k of kits)k.parts=await q("SELECT kp.item_id AS \"itemId\",kp.quantity,i.name FROM kit_parts kp JOIN items i ON i.id=kp.item_id WHERE kp.kit_id=$1",[k.id]);res.json(kits)});
app.post("/api/kits",auth,async(req,res)=>{const x=req.body;if(!x.name||!Array.isArray(x.parts)||!x.parts.length)return res.status(400).json({error:"Nome e composição obrigatórios"});const client=await pool.connect();try{await client.query("BEGIN");const k=(await client.query("INSERT INTO kits(name,price) VALUES($1,$2) RETURNING id",[x.name,+x.price||0])).rows[0];for(const p of x.parts)await client.query("INSERT INTO kit_parts(kit_id,item_id,quantity) VALUES($1,$2,$3)",[k.id,p.itemId,p.quantity]);await client.query("COMMIT");res.json(k)}catch(e){await client.query("ROLLBACK");res.status(400).json({error:e.message})}finally{client.release()}});
app.put("/api/kits/:id",auth,async(req,res)=>{
  const x=req.body;

  if(!x.name || !Array.isArray(x.parts) || !x.parts.length){
    return res.status(400).json({
      error:"Nome e composição obrigatórios"
    });
  }

  const client=await pool.connect();

  try{
    await client.query("BEGIN");

    await client.query(
      "UPDATE kits SET name=$1,price=$2 WHERE id=$3",
      [x.name,+x.price||0,req.params.id]
    );

    await client.query(
      "DELETE FROM kit_parts WHERE kit_id=$1",
      [req.params.id]
    );

    for(const p of x.parts){
      await client.query(
        "INSERT INTO kit_parts(kit_id,item_id,quantity) VALUES($1,$2,$3)",
        [req.params.id,p.itemId,p.quantity]
      );
    }

    await client.query("COMMIT");

    res.json({ok:true});

  }catch(e){

    await client.query("ROLLBACK");

    res.status(400).json({
      error:e.message
    });

  }finally{

    client.release();

  }
});
app.delete("/api/kits/:id",auth,async(req,res)=>{await q("UPDATE kits SET active=false WHERE id=$1",[req.params.id]);res.json({ok:true})});

app.get("/api/reservations",auth,async(req,res)=>res.json(await q(`SELECT r.*,c.name client_name,k.name kit_name FROM reservations r JOIN clients c ON c.id=r.client_id JOIN kits k ON k.id=r.kit_id ORDER BY r.event_date`)));
app.post("/api/reservations",auth,async(req,res)=>{const x=req.body;if(!x.clientId||!x.kitId||!x.eventDate)return res.status(400).json({error:"Cliente, kit e data são obrigatórios"});const k=(await q("SELECT * FROM kits WHERE id=$1 AND active=true",[x.kitId]))[0];if(!k)return res.status(404).json({error:"Kit não encontrado"});const cc=await conflicts(x.kitId,x.eventDate);if(cc.length)return res.status(409).json({error:"Conflito de estoque",conflicts:cc});const r=await q("INSERT INTO reservations(client_id,kit_id,event_date,value,paid,pickup,return_time,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",[x.clientId,x.kitId,x.eventDate,k.price,+x.paid||0,x.pickup||"",x.returnTime||"",x.notes||"",req.user.id]);res.json(r[0])});
app.put("/api/reservations/:id",auth,async(req,res)=>{const old=(await q("SELECT * FROM reservations WHERE id=$1",[req.params.id]))[0];if(!old)return res.status(404).json({error:"Reserva não encontrada"});const x=req.body,k=(await q("SELECT * FROM kits WHERE id=$1",[x.kitId||old.kit_id]))[0],date=x.eventDate||old.event_date,cc=await conflicts(k.id,date,old.id);if(cc.length)return res.status(409).json({error:"Conflito de estoque",conflicts:cc});await q("UPDATE reservations SET client_id=$1,kit_id=$2,event_date=$3,value=$4,paid=$5,pickup=$6,return_time=$7,notes=$8,status=$9 WHERE id=$10",[x.clientId||old.client_id,k.id,date,k.price,x.paid??old.paid,x.pickup??old.pickup,x.returnTime??old.return_time,x.notes??old.notes,x.status||old.status,old.id]);res.json({ok:true})});
app.delete("/api/reservations/:id",auth,async(req,res)=>{await q("UPDATE reservations SET status='Cancelada' WHERE id=$1",[req.params.id]);res.json({ok:true})});

app.get("/api/payments/:reservationId",auth,async(req,res)=>res.json(await q("SELECT * FROM payments WHERE reservation_id=$1 ORDER BY paid_at DESC",[req.params.reservationId])));
app.post("/api/payments",auth,async(req,res)=>{const x=req.body;if(!x.reservationId||+x.amount<=0)return res.status(400).json({error:"Reserva e valor obrigatórios"});const r=await q("INSERT INTO payments(reservation_id,amount,method,note) VALUES($1,$2,$3,$4) RETURNING id",[x.reservationId,+x.amount,x.method||"",x.note||""]);await q("UPDATE reservations SET paid=COALESCE((SELECT SUM(amount) FROM payments WHERE reservation_id=$1),0) WHERE id=$1",[x.reservationId]);res.json(r[0])});

app.post("/api/reservations/:id/contract",auth,async(req,res)=>{await q("UPDATE reservations SET contract_status='Gerado' WHERE id=$1",[req.params.id]);res.json({ok:true})});

app.get("/api/users",auth,admin,async(req,res)=>res.json(await q("SELECT id,name,email,role,created_at FROM users ORDER BY name")));
app.post("/api/users",auth,admin,async(req,res)=>{const x=req.body;if(!x.name||!x.email||!x.password)return res.status(400).json({error:"Nome, e-mail e senha obrigatórios"});const hash=bcrypt.hashSync(x.password,10);try{const r=await q("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,name,email,role",[x.name,x.email,hash,x.role||"operador"]);res.json(r[0])}catch(e){res.status(400).json({error:"E-mail já cadastrado"})}});
app.put("/api/users/:id",auth,admin,async(req,res)=>{const x=req.body;if(x.password){const h=bcrypt.hashSync(x.password,10);await q("UPDATE users SET name=$1,email=$2,role=$3,password_hash=$4 WHERE id=$5",[x.name,x.email,x.role,h,req.params.id])}else await q("UPDATE users SET name=$1,email=$2,role=$3 WHERE id=$4",[x.name,x.email,x.role,req.params.id]);res.json({ok:true})});

app.get("/api/health",async(req,res)=>{try{await q("SELECT 1");res.json({ok:true,version:"5.0.0",database:"online"})}catch(e){res.status(503).json({ok:false,error:e.message})}});
app.get("/{*splat}",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
init().then(()=>app.listen(PORT,()=>console.log("P&M ERP V5 em http://localhost:"+PORT))).catch(e=>{console.error(e);process.exit(1)});
