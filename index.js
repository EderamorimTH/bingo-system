const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Conexão com MongoDB
mongoose.connect('mongodb://localhost:27017/bingo', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log("MongoDB conectado"))
.catch(err => console.log("Erro MongoDB:", err));

// Schema da cartela
const cartelaSchema = new mongoose.Schema({
    id: { type: Number, required: true, unique: true },
    numeros: [{ type: Number, required: true }],
    dono: { type: String, default: null } // Nome do comprador
});
const Cartela = mongoose.model('Cartela', cartelaSchema);

// Schema do sorteio
const sorteioSchema = new mongoose.Schema({
    numerosSorteados: [{ type: Number }],
    vencedor: { type: mongoose.Schema.Types.ObjectId, ref: 'Cartela', default: null },
    premioAtual: { type: String, default: "" }
});
const Sorteio = mongoose.model('Sorteio', sorteioSchema);

// Rotas

// Cadastro de cartela
app.post('/cartela', async (req, res) => {
    try {
        let cartelaId = Number(req.body.id);
        if (isNaN(cartelaId)) return res.status(400).send("ID da cartela inválido");

        let numeros = req.body.numeros.map(n => Number(n));
        if (numeros.some(isNaN)) return res.status(400).send("Números inválidos");

        const cartela = new Cartela({
            id: cartelaId,
            numeros,
            dono: req.body.dono || null
        });

        await cartela.save();
        res.status(201).send({ message: "Cartela cadastrada!", cartela });
    } catch (err) {
        console.error(err);
        res.status(500).send("Erro ao cadastrar cartela");
    }
});

// Listar cartelas
app.get('/cartelas', async (req, res) => {
    const cartelas = await Cartela.find();
    res.send(cartelas);
});

// Realizar sorteio
app.post('/sorteio', async (req, res) => {
    try {
        let numeroSorteado = Number(req.body.numero);
        if (isNaN(numeroSorteado)) return res.status(400).send("Número sorteado inválido");

        let sorteio = await Sorteio.findOne() || new Sorteio({ numerosSorteados: [] });
        sorteio.numerosSorteados.push(numeroSorteado);

        // Verifica vencedores
        let vencedores = await Cartela.find({ numeros: numeroSorteado, dono: { $ne: null } });
        if (vencedores.length > 0) {
            sorteio.vencedor = vencedores[0]._id; // pega primeiro vencedor
        }

        sorteio.premioAtual = req.body.premio || sorteio.premioAtual;
        await sorteio.save();

        res.send({ message: "Número sorteado!", sorteio });
    } catch (err) {
        console.error(err);
        res.status(500).send("Erro no sorteio");
    }
});

// Painel do admin
app.get('/painel', async (req, res) => {
    const sorteio = await Sorteio.findOne().populate('vencedor');
    res.send(sorteio);
});

// Reiniciar sorteio
app.post('/reiniciar', async (req, res) => {
    await Sorteio.deleteMany({});
    res.send({ message: "Sorteio reiniciado" });
});

// Excluir todas cartelas
app.post('/excluir-todas', async (req, res) => {
    await Cartela.deleteMany({});
    res.send({ message: "Todas cartelas excluídas" });
});

// Excluir cartela por número
app.post('/excluir-numero', async (req, res) => {
    let cartelaId = Number(req.body.id);
    if (isNaN(cartelaId)) return res.status(400).send("ID inválido");
    await Cartela.deleteOne({ id: cartelaId });
    res.send({ message: "Cartela excluída" });
});

app.listen(10000, () => console.log("Servidor rodando em http://localhost:10000"));
