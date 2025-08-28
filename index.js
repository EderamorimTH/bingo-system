require('dotenv').config();
if(adminPass !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Senha inválida' });
let draw = await Draw.findOne();
if(!draw.numbers.includes(number)) draw.numbers.push(number);
await draw.save();
io.emit('numberAdded', { number, numbers: draw.numbers });
res.json({ ok: true });
});


// Editar / remover número
app.post('/api/remove-number', async (req,res)=>{
const { adminPass, number } = req.body;
if(adminPass !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Senha inválida' });
let draw = await Draw.findOne();
draw.numbers = draw.numbers.filter(n=>n!==number);
await draw.save();
io.emit('numberRemoved', { number, numbers: draw.numbers });
res.json({ ok: true });
});


// Marcar vencedores (ex: manual ou automático quando uma cartela completa)
app.post('/api/mark-winner', async (req,res)=>{
const { adminPass, cardId } = req.body;
if(adminPass !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Senha inválida' });
const card = await Card.findOne({ id: cardId });
if(!card) return res.status(404).json({ error: 'Cartela não existe' });
card.isWinner = true;
await card.save();
const draw = await Draw.findOne();
const player = card.owner || { name: 'Sem dono', phone: '' };
draw.winners.push({ cardId, playerName: player.name, playerPhone: player.phone, prize: draw.currentPrize });
await draw.save();
io.emit('winner', { cardId, player, prize: draw.currentPrize });
res.json({ ok: true });
});


// Atualizar premio
app.post('/api/update-prize', async (req,res)=>{
const { adminPass, prize } = req.body;
if(adminPass !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Senha inválida' });
const draw = await Draw.findOne();
draw.currentPrize = prize;
await draw.save();
io.emit('prizeUpdated', { prize });
res.json({ ok: true });
});


// Informação pública do draw
app.get('/api/draw', async (req,res)=>{
const draw = await Draw.findOne();
res.json(draw);
});


// Lista de cartelas e donos
app.get('/api/cards', async (req,res)=>{
const cards = await Card.find().sort({ id: 1 });
res.json(cards);
});


// Socket.IO
io.on('connection', socket=>{
console.log('Cliente conectado');
socket.on('requestState', async ()=>{
const draw = await Draw.findOne();
const cards = await Card.find().sort({ id:1 });
socket.emit('state', { draw, cards });
});
});


const PORT = process.env.PORT || 10000;
server.listen(PORT, ()=>console.log('Servidor rodando', PORT));
