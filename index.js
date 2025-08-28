const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const Cartela = require('./models/Cartela');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 10000;

// MongoDB Atlas
const MONGO_URI = 'mongodb+srv://Amorim:SENHA@cluster0.8vhg4ws.mongodb.net/bingo?retryWrites=true&w=majority';

mongoose.connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log('✅ MongoDB Atlas conectado'))
.catch(err => console.error('Erro MongoDB:', err));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.use(express.static('public'));

// ROTAS
app.get('/', async (req, res) => {
    const cartelas = await Cartela.find();
    res.render('index', { cartelas });
});

// Criar nova cartela
app.post('/cartela', async (req, res) => {
    const { numeros, dono } = req.body;
    const novaCartela = new Cartela({ numeros, dono });
    await novaCartela.save();
    res.json({ sucesso: true, cartela: novaCartela });
});

// Sorteio
app.post('/sorteio', async (req, res) => {
    const { numero, premio } = req.body;

    // Atualiza cartelas com o número sorteado
    const cartelas = await Cartela.find({ numeros: numero });
    for (let cartela of cartelas) {
        cartela.premio = premio;
        await cartela.save();
    }

    // Notifica clientes via socket
    io.emit('numero-sorteado', { numero, premio });
    res.json({ sucesso: true });
});

// Socket.io
io.on('connection', (socket) => {
    console.log('🚀 Novo cliente conectado');

    socket.on('disconnect', () => {
        console.log('❌ Cliente desconectado');
    });
});

// Servidor
server.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});
