const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const mongoose = require('mongoose');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');

app.use(bodyParser.json());
app.use(cookieParser());
app.use(express.static('public'));

// Conexão MongoDB
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB conectado'))
  .catch(err => console.error(err));

// Schemas
const CardSchema = new mongoose.Schema({ id: Number, numbers: Object });
const PlayerSchema = new mongoose.Schema({ name: String, phone: String, cardIds: [Number] });
const GameStateSchema = new mongoose.Schema({ drawnNumbers: { type: [Number], default: [] }, prize: String });
const WinnerSchema = new mongoose.Schema({ playerId: String, cardId: Number, time: Date, current: { type: Boolean, default: true } });

const Card = mongoose.model('Card', CardSchema);
const Player = mongoose.model('Player', PlayerSchema);
const GameState = mongoose.model('GameState', GameStateSchema);
const Winner = mongoose.model('Winner', WinnerSchema);

// Gerar cartelas fixas se não existirem
async function generateCards() {
  const count = await Card.countDocuments();
  if (count === 0) {
    const columns = { B: [1,15], I: [16,30], N: [31,45], G: [46,60], O: [61,75] };
    for (let id = 1; id <= 500; id++) {
      const numbers = {};
      for (let col in columns) {
        const [min, max] = columns[col];
        let nums = Array.from({length: max - min + 1}, (_, i) => min + i);
        nums = nums.sort(() => Math.random() - 0.5).slice(0, 5).sort((a,b) => a - b);
        numbers[col] = nums;
      }
      numbers.N[2] = 0; // FREE como 0
      await new Card({ id, numbers }).save();
    }
    console.log('500 cartelas geradas');
  }
}
generateCards();

// Inicializar game state se não existir
async function initGameState() {
  let state = await GameState.findOne();
  if (!state) state = new GameState({ prize: '' });
  await state.save();
}
initGameState();

// Função para shuffle (auxiliar)
function shuffle(array) {
  return array.sort(() => Math.random() - 0.5);
}

// Autenticação admin simples
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

app.post('/login', (req, res) => {
  if (req.body.password === ADMIN_PASSWORD) {
    res.cookie('auth', 'true', { httpOnly: true });
    res.send({ success: true });
  } else {
    res.send({ success: false });
  }
});

// Middleware auth para /admin routes
function auth(req, res, next) {
  if (req.cookies.auth === 'true') next();
  else res.status(401).send('Não autorizado');
}

// Rotas
app.get('/admin', auth, (req, res) => res.sendFile(__dirname + '/public/admin.html'));
app.get('/display', (req, res) => res.sendFile(__dirname + '/public/display.html'));
app.get('/sorter', (req, res) => res.sendFile(__dirname + '/public/sorter.html'));

app.get('/player-cards', (req, res) => res.sendFile(__dirname + '/public/player-cards.html'));

app.get('/download-cards', async (req, res) => {
  const cards = await Card.find().sort('id');
  const doc = new PDFDocument();
  res.setHeader('Content-disposition', 'attachment; filename=cartelas.pdf');
  res.setHeader('Content-type', 'application/pdf');
  doc.pipe(res);

  cards.forEach((card, index) => {
    if (index > 0) doc.addPage();
    doc.fontSize(25).text(`Cartela ID: ${card.id}`, 100, 50);
    const letters = ['B', 'I', 'N', 'G', 'O'];
    const startX = 100, startY = 100, cellSize = 80;
    // Cabeçalho
    letters.forEach((lettr, col) => doc.fontSize(20).text(lettr, startX + col * cellSize + 25, startY));
    // Grid lines
    for (let row = 0; row <= 5; row++) {
      doc.moveTo(startX, startY + 50 + row * cellSize).lineTo(startX + 5 * cellSize, startY + 50 + row * cellSize).stroke();
      doc.moveTo(startX + row * cellSize, startY + 50).lineTo(startX + row * cellSize, startY + 50 + 5 * cellSize).stroke();
    }
    // Números
    for (let row = 0; row < 5; row++) {
      letters.forEach((lettr, col) => {
        let num = card.numbers[lettr][row];
        if (num === 0) num = 'FREE';
        doc.fontSize(18).text(num.toString(), startX + col * cellSize + 25, startY + 60 + row * cellSize);
      });
    }
  });
  doc.end();
});

// API para admin
app.post('/assign-card', auth, async (req, res) => {
  const { name, phone, cardId } = req.body;
  let player = await Player.findOne({ phone });
  if (!player) player = new Player({ name, phone, cardIds: [] });
  if (!player.cardIds.includes(cardId)) player.cardIds.push(cardId);
  await player.save();
  emitUpdate();
  res.send({ success: true });
});

app.post('/add-card', auth, async (req, res) => {
  const { phone, cardId } = req.body;
  const player = await Player.findOne({ phone });
  if (player && !player.cardIds.includes(cardId)) {
    player.cardIds.push(cardId);
    await player.save();
    emitUpdate();
  }
  res.send({ success: !!player });
});

app.post('/remove-card', auth, async (req, res) => {
  const { phone, cardId } = req.body;
  const player = await Player.findOne({ phone });
  if (player) {
    player.cardIds = player.cardIds.filter(id => id !== cardId);
    await player.save();
    await Winner.deleteMany({ cardId }); // Remove se vencedor
    emitUpdate();
  }
  res.send({ success: !!player });
});

app.post('/delete-player', auth, async (req, res) => {
  const { phone } = req.body;
  const player = await Player.findOneAndDelete({ phone });
  if (player) await Winner.deleteMany({ playerId: player._id });
  emitUpdate();
  res.send({ success: !!player });
});

app.post('/delete-all-players', auth, async (req, res) => {
  await Player.deleteMany({});
  await Winner.deleteMany({});
  emitUpdate();
  res.send({ success: true });
});

app.post('/update-prize', auth, async (req, res) => {
  const state = await GameState.findOne();
  state.prize = req.body.prize;
  await state.save();
  emitUpdate();
  res.send({ success: true });
});

app.post('/restart', auth, async (req, res) => {
  const state = await GameState.findOne();
  state.drawnNumbers = [];
  await Winner.updateMany({}, { current: false });
  await state.save();
  emitUpdate();
  res.send({ success: true });
});

// API para sorteio
app.post('/draw-number', async (req, res) => {
  const { number } = req.body;
  const state = await GameState.findOne();
  if (!state.drawnNumbers.includes(number) && number >= 1 && number <= 75) {
    state.drawnNumbers.push(number);
    await state.save();
    await checkWinners();
    emitUpdate();
    res.send({ success: true });
  } else {
    res.send({ success: false });
  }
});

app.post('/draw-random', async (req, res) => {
  const state = await GameState.findOne();
  const available = Array.from({length: 75}, (_, i) => i + 1).filter(n => !state.drawnNumbers.includes(n));
  if (available.length > 0) {
    const number = available[Math.floor(Math.random() * available.length)];
    state.drawnNumbers.push(number);
    await state.save();
    await checkWinners();
    emitUpdate();
    res.send({ number });
  } else {
    res.send({ success: false });
  }
});

// Verificar vencedores
async function checkWinners() {
  const state = await GameState.findOne();
  const drawnSet = new Set(state.drawnNumbers);
  const players = await Player.find();
  for (let player of players) {
    for (let cardId of player.cardIds) {
      const card = await Card.findOne({ id: cardId });
      const cardNums = [];
      for (let col in card.numbers) {
        card.numbers[col].forEach(n => { if (n !== 0) cardNums.push(n); });
      }
      if (cardNums.every(n => drawnSet.has(n))) {
        const existing = await Winner.findOne({ playerId: player._id, cardId });
        if (!existing) {
          await new Winner({ playerId: player._id, cardId, time: new Date() }).save();
        }
      }
    }
  }
}

// Emitir atualizações em tempo real
async function emitUpdate() {
  const state = await GameState.findOne();
  const players = await Player.find();
  const currentWinners = await Winner.find({ current: true }).populate('playerId');
  const allWinners = await Winner.find().populate('playerId');

  const drawn = state.drawnNumbers;
  const last = drawn[drawn.length - 1] || null;
  const last5 = drawn.slice(-5).reverse();
  const prize = state.prize;

  const organized = {
    B: drawn.filter(n => n >=1 && n <=15).sort((a,b)=>a-b),
    I: drawn.filter(n => n >=16 && n <=30).sort((a,b)=>a-b),
    N: drawn.filter(n => n >=31 && n <=45).sort((a,b)=>a-b),
    G: drawn.filter(n => n >=46 && n <=60).sort((a,b)=>a-b),
    O: drawn.filter(n => n >=61 && n <=75).sort((a,b)=>a-b)
  };

  const data = { drawn, last, last5, prize, organized };

  // Para display e sorter: vencedores atuais com máscara
  const winnersPublic = currentWinners.map(w => ({
    cardId: w.cardId,
    phone: maskPhone(w.playerId ? w.playerId.phone : '')
  }));

  // Para admin: todos vencedores com máscara
  const winnersAdmin = allWinners.map(w => ({
    cardId: w.cardId,
    phone: maskPhone(w.playerId ? w.playerId.phone : ''),
    name: w.playerId ? w.playerId.name : '',
    time: w.time
  }));

  // Para players list no admin
  const playersList = players.map(p => ({
    name: p.name,
    phone: maskPhone(p.phone),
    cardIds: p.cardIds,
    link: `/player-cards?id=${p._id}`
  }));

  io.emit('update', { ...data, winners: winnersPublic }); // Para public
  io.emit('admin-update', { players: playersList, allWinners: winnersAdmin, ...data }); // Para admin
}

// Máscara de telefone (exemplo simples, ajuste formato)
function maskPhone(phone) {
  if (!phone) return '';
  return phone.replace(/\d(?=\d{4})/g, '*');
}

// Socket connection
io.on('connection', socket => {
  emitUpdate(); // Envia estado inicial
  // Pode adicionar rooms se necessário, mas por agora global
});

// API para get player cards
app.get('/get-player-cards', async (req, res) => {
  const player = await Player.findById(req.query.id);
  if (!player) return res.status(404).send('Não encontrado');
  const cards = await Card.find({ id: { $in: player.cardIds } });
  const state = await GameState.findOne();
  res.send({ name: player.name, cardIds: player.cardIds, cards: cards.map(c => c.numbers), prize: state.prize });
});

// API para get state (para front)
app.get('/get-state', async (req, res) => {
  // Similar a emitUpdate, mas para initial load se necessário
  res.send({}); // Use socket para real-time
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
