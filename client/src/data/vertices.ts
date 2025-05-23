interface VertexData {
    adjacentHexes: string[];
    adjacentVertices: string[];
    renderFrom: string;
    position: string;
}

const vertices: { [vertexId: string]: VertexData } = {
    vA1: {
        adjacentHexes: ['A1'],
        adjacentVertices: ['vA2', 'vB2'],
        renderFrom: 'A1',
        position: 'top-left',
    },
    vA2: {
        adjacentHexes: ['A1'],
        adjacentVertices: ['vA1', 'vA3'],
        renderFrom: 'A1',
        position: 'top',
    },
    vA3: {
        adjacentHexes: ['A1', 'A2'],
        adjacentVertices: ['vA2', 'vA4', 'vB4'],
        renderFrom: 'A1',
        position: 'top-right',
    },
    vA4: {
        adjacentHexes: ['A2'],
        adjacentVertices: ['vA3', 'vA5'],
        renderFrom: 'A2',
        position: 'top',
    },
    vA5: {
        adjacentHexes: ['A2', 'A3'],
        adjacentVertices: ['vA4', 'vA6', 'vB6'],
        renderFrom: 'A2',
        position: 'top-right',
    },
    vA6: {
        adjacentHexes: ['A3'],
        adjacentVertices: ['vA5', 'vA7'],
        renderFrom: 'A3',
        position: 'top',
    },
    vA7: {
        adjacentHexes: ['A3'],
        adjacentVertices: ['vA6', 'vB8'],
        renderFrom: 'A3',
        position: 'top-right',
    },
    vB1: {
        adjacentHexes: ['B1'],
        adjacentVertices: ['vB2', 'vC2'],
        renderFrom: 'B1',
        position: 'top-left', 
    },
    vB2: {
        adjacentHexes: ['A1', 'B1'],
        adjacentVertices: ['vA1', 'vB1', 'vB3'],
        renderFrom: 'B1',
        position: 'top', 
    },
    vB3: {
        adjacentHexes: ['A1', 'B1', 'B2'],
        adjacentVertices: ['vB2', 'vB4', 'vC4'],
        renderFrom: 'B1',
        position: 'top-right', 
    },
    vB4: {
        adjacentHexes: ['A1', 'A2', 'B2'],
        adjacentVertices: ['vA3', 'vB3', 'vB5'],
        renderFrom: 'B2',
        position: 'top', 
    },
    vB5: {
        adjacentHexes: ['A2', 'B2', 'B3'],
        adjacentVertices: ['vB4', 'vB6', 'vC6'],
        renderFrom: 'B2',
        position: 'top-right', 
    },
    vB6: {
        adjacentHexes: ['A2', 'A3', 'B3'],
        adjacentVertices: ['vA5', 'vB5', 'vB7'],
        renderFrom: 'B3',
        position: 'top', 
    },
    vB7: {
        adjacentHexes: ['A3', 'B3', 'B4'],
        adjacentVertices: ['vB6', 'vB8', 'vC8'],
        renderFrom: 'B3',
        position: 'top-right', 
    },
    vB8: {
        adjacentHexes: ['A3', 'B4'],
        adjacentVertices: ['vA7', 'vB7', 'vB9'],
        renderFrom: 'B4',
        position: 'top', 
    },
    vB9: {
        adjacentHexes: ['B4'],
        adjacentVertices: ['vB8', 'vC10'],
        renderFrom: 'B4',
        position: 'top-right', 
    },
    vC1: {
        adjacentHexes: ['C1'],
        adjacentVertices: ['vC2', 'vD1'],
        renderFrom: 'C1',
        position: 'top-left', 
    },
    vC2: {
        adjacentHexes: ['B1', 'C1'],
        adjacentVertices: ['vB1', 'vC1', 'vC3'],
        renderFrom: 'C1',
        position: 'top', 
    },
    vC3: {
        adjacentHexes: ['B1', 'C1', 'C2'],
        adjacentVertices: ['vC2', 'vC4', 'vD3'],
        renderFrom: 'C1',
        position: 'top-right', 
    },
    vC4: {
        adjacentHexes: ['B1', 'B2', 'C2'],
        adjacentVertices: ['vB3', 'vC3', 'vC5'],
        renderFrom: 'C2',
        position: 'top', 
    },
    vC5: {
        adjacentHexes: ['B2', 'C2', 'C3'],
        adjacentVertices: ['vC4', 'vC6', 'vD5'],
        renderFrom: 'C2',
        position: 'top-right', 
    },
    vC6: {
        adjacentHexes: ['B2', 'B3', 'C3'],
        adjacentVertices: ['vB5', 'vC5', 'vC7'],
        renderFrom: 'C3',
        position: 'top', 
    },
    vC7: {
        adjacentHexes: ['B3', 'C3', 'C4'],
        adjacentVertices: ['vC6', 'vC8', 'vD7'],
        renderFrom: 'C3',
        position: 'top-right', 
    },
    vC8: {
        adjacentHexes: ['B3', 'B4', 'C4'],
        adjacentVertices: ['vB7', 'vC7', 'vC9'],
        renderFrom: 'C4',
        position: 'top', 
    },
    vC9: {
        adjacentHexes: ['B4', 'C4', 'C5'],
        adjacentVertices: ['vC8', 'vC10', 'vD9'],
        renderFrom: 'C4',
        position: 'top-right', 
    },
    vC10: {
        adjacentHexes: ['B4', 'C5'],
        adjacentVertices: ['vB9', 'vC9', 'vC11'],
        renderFrom: 'C5',
        position: 'top', 
    },
    vC11: {
        adjacentHexes: ['C5'],
        adjacentVertices: ['vC10', 'vD11'],
        renderFrom: 'C5',
        position: 'top-right', 
    },
    vD1: {
        adjacentHexes: ['C1'],
        adjacentVertices: ['vC1', 'vD2'],
        renderFrom: 'C1',
        position: 'bottom-left', 
    },
    vD2: {
        adjacentHexes: ['C1', 'D1'],
        adjacentVertices: ['vD1', 'vD3', 'vE1'],
        renderFrom: 'D1',
        position: 'top-left', 
    },
    vD3: {
        adjacentHexes: ['C1', 'C2', 'D1'],
        adjacentVertices: ['vC3', 'vD2', 'vD4'],
        renderFrom: 'D1',
        position: 'top', 
    },
    vD4: {
        adjacentHexes: ['C2', 'D1', 'D2'],
        adjacentVertices: ['vD3', 'vD5', 'vE3'],
        renderFrom: 'D1',
        position: 'top-right', 
    },
    vD5: {
        adjacentHexes: ['C2', 'C3', 'D2'],
        adjacentVertices: ['vC5', 'vD4', 'vD6'],
        renderFrom: 'D2',
        position: 'top', 
    },
    vD6: {
        adjacentHexes: ['C3', 'D2', 'D3'],
        adjacentVertices: ['vD5', 'vD7', 'vE5'],
        renderFrom: 'D2',
        position: 'top-right', 
    },
    vD7: {
        adjacentHexes: ['C3', 'C4', 'D3'],
        adjacentVertices: ['vC7', 'vD6', 'vD8'],
        renderFrom: 'D3',
        position: 'top', 
    },
    vD8: {
        adjacentHexes: ['C4', 'D3', 'D4'],
        adjacentVertices: ['vD7', 'vD9', 'vE7'],
        renderFrom: 'D3',
        position: 'top-right', 
    },
    vD9: {
        adjacentHexes: ['C4', 'C5', 'D4'],
        adjacentVertices: ['vC9', 'vD8', 'vD10'],
        renderFrom: 'D4',
        position: 'top', 
    },
    vD10: {
        adjacentHexes: ['C5', 'D4'],
        adjacentVertices: ['vD9', 'vD11', 'vE9'],
        renderFrom: 'D4',
        position: 'top-right', 
    },
    vD11: {
        adjacentHexes: ['C5'],
        adjacentVertices: ['vC11', 'vD10'],
        renderFrom: 'C5',
        position: 'bottom-right', 
    },
    vE1: {
        adjacentHexes: ['D1'],
        adjacentVertices: ['vD2', 'vE2'],
        renderFrom: 'D1',
        position: 'bottom-left', 
    },
    vE2: {
        adjacentHexes: ['D1', 'E1'],
        adjacentVertices: ['vE1', 'vE3', 'vF1'],
        renderFrom: 'E1',
        position: 'top-left',
    },
    vE3: {
        adjacentHexes: ['D1', 'D2', 'E1'],
        adjacentVertices: ['vD4', 'vE2', 'vE4'],
        renderFrom: 'E1',
        position: 'top',
    },
    vE4: {
        adjacentHexes: ['D2', 'E1', 'E2'],
        adjacentVertices: ['vE3', 'vE5', 'vF3'],
        renderFrom: 'E1',
        position: 'top-right',
    },
    vE5: {
        adjacentHexes: ['D2', 'D3', 'E2'],
        adjacentVertices: ['vD6', 'vE4', 'vE6'],
        renderFrom: 'E2',
        position: 'top',
    },
    vE6: {
        adjacentHexes: ['D3', 'E2', 'E3'],
        adjacentVertices: ['vE5', 'vE7', 'vF5'],
        renderFrom: 'E2',
        position: 'top-right',
    },
    vE7: {
        adjacentHexes: ['D3', 'D4', 'E3'],
        adjacentVertices: ['vD8', 'vE6', 'vE8'],
        renderFrom: 'E3',
        position: 'top',
    },
    vE8: {
        adjacentHexes: ['D4', 'E3'],
        adjacentVertices: ['vE7', 'vE9', 'vF7'],
        renderFrom: 'E3',
        position: 'top-right',
    },
    vE9: {
        adjacentHexes: ['D4'],
        adjacentVertices: ['vE8', 'vD10'],
        renderFrom: 'D4',
        position: 'bottom-right',
    },
    vF1: {
        adjacentHexes: ['E1'],
        adjacentVertices: ['vE2', 'vF2'],
        renderFrom: 'E1',
        position: 'bottom-left',
    },
    vF2: {
        adjacentHexes: ['E1'],
        adjacentVertices: ['vF1', 'vF3'],
        renderFrom: 'E1',
        position: 'bottom',
    },
    vF3: {
        adjacentHexes: ['E1', 'E2'],
        adjacentVertices: ['vE4', 'vF2', 'vF4'],
        renderFrom: 'E1',
        position: 'bottom-right',
    },
    vF4: {
        adjacentHexes: ['E2'],
        adjacentVertices: ['vF3', 'vF5'],
        renderFrom: 'E2',
        position: 'bottom',
    },
    vF5: {
        adjacentHexes: ['E2', 'E3'],
        adjacentVertices: ['vE6', 'vF4', 'vF6'],
        renderFrom: 'E2',
        position: 'bottom-right',
    },
    vF6: {
        adjacentHexes: ['E3'],
        adjacentVertices: ['vF5', 'vF7'],
        renderFrom: 'E3',
        position: 'bottom',
    },
    vF7: {
        adjacentHexes: ['E3'],
        adjacentVertices: ['vF6', 'vE8'],
        renderFrom: 'E3',
        position: 'bottom-right',
    },




}

export default vertices;