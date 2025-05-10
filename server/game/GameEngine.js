class GameEngine {
    constructor(state) {
        this.state = state;
    }
    
    canPlaceSettlement(playerId, vertexId) {
        const isTurn = this.state.turnOrder[this.state.activePlayerIndex] === playerId;
        const alreadyPlaced = Object.values(this.state.settlements || {}).some(setts => 
            setts.include(vertexId)
        );
        
        return isTurn && !alreadyPlaced;
    }

    placeSettlement(playerId, vertexId) {
        if (!this.canPlaceSettlement(playerId, vertexId)) {
            throw new Error('Cannot Place Settlement Here');
        }

        if (!this.state.settlements[playerId]) {
            this.state.settlements[plauyerId] = [];
        }

        this.state.settlements[playerId].push(vertexId);
    }
}

module.exports = GameEngine;