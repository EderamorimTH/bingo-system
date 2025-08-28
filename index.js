const express = require('express');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const PDFDocument = require('pdfkit');
const path = require('path');
const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Conectar MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

// Schemas
const cartelaSchema = new mongoose.Schema({
  cartelaId: String,
  numbers: [[Number]]
});
const Cartela = mongoose.model('Cartela', cartelaSchema, 'cartelas'); // <-- força coleção "cartelas"

const cartelaAtribuidaSchema = new mongoose.Schema({
  cartelaId: String,
  numbers: [[Number]],
  playerName: String,
  phoneNumber: String,
  markedNumbers: { type: [Number], default: [] },
  createdAt: { type: Date, default: Date.now }
});
const CartelaAtribuida = mongoose.model('CartelaAtribuida', cartelaAtribuidaSchema, 'assignedcartelas'); 
// <-- força coleção "assignedcartelas"

const playerSchema = new mongoose.Schema({
  playerName: String,
  phoneNumber: String,
  cartelaIds: [String],
  link: String,
  createdAt: Date
});
const Player = mongoose.model('Player', playerSchema, 'players'); // <-- força coleção "players"

// Autenticação simples
const isAuthenticated = (req, res, next) => next();

// ------------------------------
// ROTA PARA ATRIBUIR CARTELAS
// ------------------------------
app.post('/assign-cartelas', isAuthenticated, async (req, res) => {
  try {
    const { cartelaNumbers, playerName, phoneNumber } = req.body;
    if (!cartelaNumbers || !playerName)
      return res.status(400).json({ error: 'Campos obrigatórios' });

    const nums = cartelaNumbers.split(',')
      .map(n => n.trim())
      .filter(n => n.match(/^[0-9]+$/))
      .map(n => parseInt(n));

    if (!nums.length) return res.status(400).json({ error: 'Números inválidos' });

    const assigned = [];
    const errors = [];

    for (const num of nums) {
      const cartelaId = `FIXA-${num}`;
      const cartela = await Cartela.findOne({ cartelaId });
      if (!cartela) {
        errors.push(`Cartela ${cartelaId} não existe.`);
        continue;
      }

      const jaAtribuida = await CartelaAtribuida.findOne({ cartelaId });
      if (jaAtribuida) {
        errors.push(`Cartela ${cartelaId} já atribuída para ${jaAtribuida.playerName}`);
        continue;
      }

      const novaCartela = new CartelaAtribuida({
        cartelaId: cartela.cartelaId,
        numbers: cartela.numbers,
        playerName,
        phoneNumber: phoneNumber || '',
        markedNumbers: []
      });
      await novaCartela.save();
      assigned.push(cartelaId);
    }

    if (!assigned.length)
      return res.status(400).json({ error: errors.join('; ') });

    let player = await Player.findOne({ playerName });
    const link = `${req.protocol}://${req.get('host')}/cartelas?playerName=${encodeURIComponent(playerName)}`;

    if (!player) {
      player = await new Player({
        playerName,
        phoneNumber,
        link,
        cartelaIds: assigned,
        createdAt: new Date()
      }).save();
    } else {
      player.cartelaIds = [...new Set([...player.cartelaIds, ...assigned])];
      if (phoneNumber) player.phoneNumber = phoneNumber;
      await player.save();
    }

    res.json({ success: true, assigned, link, playerName });
  } catch (err) {
    console.error('Erro ao atribuir cartelas:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ------------------------------
// ROTA PARA REMOVER CARTELAS DE UM JOGADOR
// ------------------------------
app.post('/remove-cartelas', isAuthenticated, async (req, res) => {
  try {
    const { playerName, cartelas } = req.body;
    const cartelaIds = cartelas.split(',').map(c => c.trim());

    await CartelaAtribuida.deleteMany({ cartelaId: { $in: cartelaIds }, playerName });
    const player = await Player.findOne({ playerName });
    if (player) {
      player.cartelaIds = player.cartelaIds.filter(c => !cartelaIds.includes(c));
      await player.save();
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao remover cartelas' });
  }
});

// ------------------------------
// ROTA PARA PEGAR STATUS DAS CARTELAS
// ------------------------------
app.get('/cartelas-stats', isAuthenticated, async (req, res) => {
  try {
    const totalAtribuidas = await CartelaAtribuida.countDocuments();
    res.json({ atribuídas: totalAtribuidas, disponíveis: 500 - totalAtribuidas });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao carregar estatísticas' });
  }
});

// ------------------------------
// ROTA PARA BAIXAR PDF DAS 500 CARTELAS
// ------------------------------
app.get('/download-cartelas', isAuthenticated, async (req, res) => {
  try {
    const cartelas = await Cartela.find().sort({ cartelaId: 1 });
    if (!cartelas.length) return res.status(404).send('Nenhuma cartela encontrada.');

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    res.setHeader('Content-disposition', 'attachment; filename=cartelas-bingo.pdf');
    res.setHeader('Content-type', 'application/pdf');
    doc.pipe(res);

    cartelas.forEach((cartela, index) => {
      if (index > 0) doc.addPage();
      doc.fontSize(18).text(`Cartela #${index + 1} | ID: ${cartela.cartelaId}`, { align: 'center' });
      doc.moveDown();

      const startX = 70;
      const startY = 120;
      const cellSize = 70;
      const headers = ['B', 'I', 'N', 'G', 'O'];

      // Cabeçalho tabela
      headers.forEach((h, i) => {
        doc.rect(startX + i * cellSize, startY, cellSize, cellSize).stroke();
        doc.fontSize(18).text(h, startX + i * cellSize + 25, startY + 25);
      });

      // Números
      for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 5; col++) {
          const num = cartela.numbers[col][row] === 0 ? 'X' : cartela.numbers[col][row];
          doc.rect(startX + col * cellSize, startY + (row + 1) * cellSize, cellSize, cellSize).stroke();
          doc.fontSize(16).text(num.toString(), startX + col * cellSize + 25, startY + (row + 1) * cellSize + 25);
        }
      }

      doc.moveDown(2);
      doc.fontSize(14).text(`Cartela ID: ${cartela.cartelaId}`, { align: 'center' });
    });

    doc.end();
  } catch (err) {
    console.error('Erro ao gerar PDF:', err);
    res.status(500).send('Erro ao gerar PDF');
  }
});

// Inicia servidor
app.listen(3000, () => console.log('Servidor rodando na porta 3000'));
