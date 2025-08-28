// generateCards.js
function shuffle(arr){
for(let i=arr.length-1;i>0;i--){
const j=Math.floor(Math.random()*(i+1));
[arr[i],arr[j]]=[arr[j],arr[i]];
}
}


function generate500(){
const cards = [];
// Gerar 500 cartelas fixas (aqui um algoritmo simples: sortear por coluna B,I,N,G,O)
for(let id=1; id<=500; id++){
const cardNumbers = [];
const ranges = [[1,15],[16,30],[31,45],[46,60],[61,75]];
for(let c=0;c<5;c++){
const arr=[];
for(let n=ranges[c][0]; n<=ranges[c][1]; n++) arr.push(n);
shuffle(arr);
// pegar 5 números por coluna (no N central pode ter "free" se quiser)
const take = arr.slice(0,5);
cardNumbers.push(take);
}
cards.push({ id, numbers: cardNumbers });
}
return cards;
}


module.exports = { generate500 };
