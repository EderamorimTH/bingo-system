const mongoose = require('mongoose');


const CardSchema = new mongoose.Schema({
id: { type: Number, unique: true }, // 1..500
numbers: [[Number]], // 5x5, ou array simples de 24 números
owner: { name: String, phone: String }, // null se não atribuído
createdAt: { type: Date, default: Date.now },
isWinner: { type: Boolean, default: false }
});


module.exports = mongoose.model('Card', CardSchema);
