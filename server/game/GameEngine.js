const vertices = require('../data/vertices');

class GameEngine {
    constructor(state) {
        this.state = state;
    }
    
    canPlaceSettlement(playerId, vertexId) {
        const isTurn = this.state.turnOrder[this.state.activePlayerIndex] === playerId;
        const alreadyPlaced = Object.values(this.state.settlements || {}).some(setts => 
            setts.includes(vertexId)
        );

        const adjacentVertices = vertices[vertexId]?.adjacentVertices || [];
        console.log('Adjacent Vertices:', adjacentVertices);
        const isAdjacentToSettlement = Object.values(this.state.settlements || {}).some(setts =>
            setts.some(settledVertex => adjacentVertices.includes(settledVertex))
        );

        const hasEnoughSettlements = (this.state.settlements[playerId] || []).length < this.state.maxSettlementsPerPlayer;
        
        
        return isTurn && hasEnoughSettlements && !isAdjacentToSettlement && !alreadyPlaced;
    }

    placeSettlement(playerId, vertexId) {
        if (!this.canPlaceSettlement(playerId, vertexId)) {
            throw new Error('Cannot Place Settlement Here');
        }

        if (!this.state.settlements[playerId]) {
            this.state.settlements[playerId] = [];
        }

        this.state.settlements[playerId].push(vertexId);
    }

    placeRoad(playerId, fromVertex, toVertex) {
        const roadKey = [fromVertex, toVertex].sort().join('-');

        // Validate that the road exists on the map
        const isValidEdge = vertices[fromVertex]?.adjacentVertices.includes(toVertex);
        if (!isValidEdge) {
            throw new Error('Invalid road placement: no edge between these vertices');
        }

        // Check if the road is already taken
        const alreadyPlaced = Object.values(this.state.roads || {}).some(roads =>
            roads.includes(roadKey)
        );
        if (alreadyPlaced) {
            throw new Error('Road already placed here');
        }

        // Check connectivity to player's existing roads or settlements
        const playerRoads = this.state.roads?.[playerId] || [];
        const playerSettlements = this.state.settlements?.[playerId] || [];
        const isConnected = playerRoads.some(road =>
            road.includes(fromVertex) || road.includes(toVertex)
        ) || playerSettlements.includes(fromVertex) || playerSettlements.includes(toVertex);

        if (!isConnected) {
            throw new Error('Road must connect to your existing road or settlement');
        }

        // Place the road
        if (!this.state.roads[playerId]) {
            this.state.roads[playerId] = [];
        }
        this.state.roads[playerId].push(roadKey);
    }

}

module.exports = GameEngine;