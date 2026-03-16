// server/server.js
// Pinochle Partners Double Deck (80-card, no 9s)
// Server-authoritative: deck, validation, scoring all on server only

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",   // ← Change to your frontend URL later (e.g. https://your-app.vercel.app)
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Pinochle Server (80-card no 9s) running on port ${PORT}`);
});

// ====================== GAME ENGINE ======================
class PinochleGame {
  constructor(roomId, wager = 0) {
    this.roomId = roomId;
    this.wager = wager;                    // Revenue placeholder: stored for escrow/rake later
    this.players = [];                     // {id, name, seat, hand: [], meld: 0, tricks: 0}
    this.deck = this.createDeck();
    this.trumpSuit = null;
    this.phase = 'waiting';                // waiting → bidding → meld → tricks → ended
    this.currentBidder = 0;
    this.highestBid = { player: null, amount: 50, suit: null }; // typical double-deck min
    this.currentTurn = 0;
    this.trickCards = [];
    this.scores = { team1: 0, team2: 0 };  // partners: 0+2 vs 1+3
  }

  createDeck() {
    const suits = ['♠', '♥', '♦', '♣'];
    const ranks = ['A', '10', 'K', 'Q', 'J']; // No 9s
    let deck = [];
    for (let i = 0; i < 4; i++) {             // four identical copies
      for (let suit of suits) {
        for (let rank of ranks) {
          deck.push({ suit, rank });
        }
      }
    }
    return deck; // 80 cards total
  }

  shuffle() {
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }

  deal() {
    this.shuffle();
    let index = 0;
    for (let player of this.players) {
      player.hand = this.deck.slice(index, index + 20);
      index += 20;
    }
  }

  getCardValue(rank) {
    const values = { 'A': 11, '10': 10, 'K': 4, 'Q': 3, 'J': 2 };
    return values[rank] || 0;
  }

  calculateMeld(hand, trumpSuit) {
    // Placeholder — expand here with full Pinochle meld rules
    // Examples: Aces around (100/150/200/300), Pinochle (40/80/120/160), Runs, Marriages, etc.
    // No Dix (no 9s)
    return 0; // ← tweak this later
  }

  isValidBid(playerId, amount, suit) {
    if (amount < this.highestBid.amount + 10 && amount !== 50) return false;
    return true;
  }

  isValidPlay(playerId, card) {
    const player = this.players.find(p => p.id === playerId);
    if (!player) return false;

    const hasCard = player.hand.some(c => c.suit === card.suit && c.rank === card.rank);
    if (!hasCard) return false;

    if (this.trickCards.length > 0) {
      const leadSuit = this.trickCards[0].suit;
      const hasLeadSuit = player.hand.some(c => c.suit === leadSuit);
      if (hasLeadSuit && card.suit !== leadSuit) return false;
    }
    return true;
  }

  startGame() {
    if (this.players.length !== 4) return;
    this.deal();
    this.phase = 'bidding';
    this.currentBidder = 0; // dealer starts
    this.broadcastState();
  }

  makeBid(socketId, amount, suit) {
    if (this.phase !== 'bidding') return;
    if (!this.isValidBid(socketId, amount, suit)) return;

    this.highestBid = { player: socketId, amount, suit };
    this.currentBidder = (this.currentBidder + 1) % 4;

    // Simple bidding end condition — improve with pass tracking later
    if (this.currentBidder === 0 && this.highestBid.player !== null) {
      this.trumpSuit = this.highestBid.suit;
      this.phase = 'meld';
      this.players.forEach(p => {
        p.meld = this.calculateMeld(p.hand, this.trumpSuit);
      });
      this.phase = 'tricks';
      this.currentTurn = this.players.findIndex(p => p.id === this.highestBid.player);
    }
    this.broadcastState();
  }

  playCard(socketId, card) {
    if (this.phase !== 'tricks') return;
    if (this.players[this.currentTurn].id !== socketId) return;
    if (!this.isValidPlay(socketId, card)) return;

    const player = this.players.find(p => p.id === socketId);
    player.hand = player.hand.filter(c => !(c.suit === card.suit && c.rank === card.rank));
    this.trickCards.push({ ...card, player: socketId });

    if (this.trickCards.length === 4) {
      // Determine trick winner
      let winnerIdx = 0;
      const leadSuit = this.trickCards[0].suit;
      for (let i = 1; i < 4; i++) {
        const curr = this.trickCards[i];
        const win = this.trickCards[winnerIdx];
        if (curr.suit === this.trumpSuit && win.suit !== this.trumpSuit) {
          winnerIdx = i;
        } else if (curr.suit === leadSuit && this.getCardValue(curr.rank) > this.getCardValue(win.rank)) {
          winnerIdx = i;
        }
      }
      const winnerId = this.trickCards[winnerIdx].player;
      const winner = this.players.find(p => p.id === winnerId);
      winner.tricks += 1;

      this.trickCards = [];
      this.currentTurn = this.players.findIndex(p => p.id === winnerId);

      // Check game end
      if (player.hand.length === 0) {
        this.phase = 'ended';
        this.scores.team1 = this.players[0].meld + this.players[2].meld +
                           (this.players[0].tricks + this.players[2].tricks) * 10;
        this.scores.team2 = this.players[1].meld + this.players[3].meld +
                           (this.players[1].tricks + this.players[3].tricks) * 10;
        // Future revenue hook: escrow release + rake here
      }
    } else {
      this.currentTurn = (this.currentTurn + 1) % 4;
    }
    this.broadcastState();
  }

  broadcastState() {
    io.to(this.roomId).emit('gameState', {
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        seat: p.seat,
        handCount: p.hand?.length || 0,
        meld: p.meld,
        tricks: p.tricks
      })),
      phase: this.phase,
      trump: this.trumpSuit,
      currentTurn: this.currentTurn,
      highestBid: this.highestBid,
      trickCards: this.trickCards,
      scores: this.scores,
      wager: this.wager
    });
  }
}

// ====================== ROOM MANAGEMENT ======================
const games = new Map();

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  socket.on('joinRoom', ({ roomId, playerName }) => {
    socket.join(roomId);
    if (!games.has(roomId)) {
      games.set(roomId, new PinochleGame(roomId));
    }
    const game = games.get(roomId);
    const seat = game.players.length;
    game.players.push({ id: socket.id, name: playerName, seat, hand: [], meld: 0, tricks: 0 });

    socket.emit('joined', { seat, wager: game.wager });
    game.broadcastState();

    if (game.players.length === 4) {
      game.startGame();
    }
  });

  socket.on('makeBid', ({ roomId, amount, suit }) => {
    const game = games.get(roomId);
    if (game) game.makeBid(socket.id, amount, suit);
  });

  socket.on('playCard', ({ roomId, card }) => {
    const game = games.get(roomId);
    if (game) game.playCard(socket.id, card);
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    // TODO: timeout handling + possible refund logic
  });
});