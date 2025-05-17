const roadSlots: { [hexId: string]: { roadId: string; slot: string }[] } = {
  A1: [
    { roadId: 'vA1-vA2', slot: 'top-left' },
    { roadId: 'vA2-vA3', slot: 'top-right' },
    { roadId: 'vA3-vB4', slot: 'right' },
    { roadId: 'vA1-vB2', slot: 'left' },
    { roadId: 'vB2-vB3', slot: 'bottom-left' },
    { roadId: 'vB3-vB4', slot: 'bottom-right' },
  ],
  A2: [
    { roadId: 'vA3-vA4', slot: 'top-left' },
    { roadId: 'vA4-vA5', slot: 'top-right' },
    { roadId: 'vA5-vB6', slot: 'right' },
    { roadId: 'vB5-vB6', slot: 'bottom-right' },
    { roadId: 'vB4-vB5', slot: 'bottom-left' },
  ],
  A3: [
    { roadId: 'vA5-vA6', slot: 'top-left' },
    { roadId: 'vA6-vA7', slot: 'top-right' },
    { roadId: 'vA7-vB8', slot: 'right' },
    { roadId: 'vB6-vB7', slot: 'bottom-left' },
    { roadId: 'vB7-vB8', slot: 'bottom-right' },
  ],

  B1: [
    { roadId: 'vB1-vB2', slot: 'top-left' },
    { roadId: 'vB1-vC2', slot: 'left' },
    { roadId: 'vC2-vC3', slot: 'bottom-left' },
    { roadId: 'vC3-vC4', slot: 'bottom-right' },
    { roadId: 'vB3-vC4', slot: 'right' },
  ],

  B2: [
    { roadId: 'vB5-vC6', slot: 'right' },
    { roadId: 'vC4-vC5', slot: 'bottom-left' },
    { roadId: 'vC5-vC6', slot: 'bottom-right' },
  ],
  
  B3: [
    { roadId: 'vB7-vC8', slot: 'right' },
    { roadId: 'vC6-vC7', slot: 'bottom-left' },
    { roadId: 'vC7-vC8', slot: 'bottom-right' },
  ],
  B4: [
    { roadId: 'vB8-vB9', slot: 'top-right' },
    { roadId: 'vB9-vC10', slot: 'right' },
    { roadId: 'vC8-vC9', slot: 'bottom-left' },
    { roadId: 'vC10-vC9', slot: 'bottom-right' },
  ],
  C1: [
    { roadId: 'vC1-vC2', slot: 'top-left' },
    { roadId: 'vC1-vD1', slot: 'left' },
    { roadId: 'vC3-vD3', slot: 'right' },
    { roadId: 'vD1-vD2', slot: 'bottom-left' },
    { roadId: 'vD2-vD3', slot: 'bottom-right' },
  ],
  C2: [
    { roadId: 'vC5-vD5', slot: 'right' },
    { roadId: 'vD3-vD4', slot: 'bottom-left' },
    { roadId: 'vD4-vD5', slot: 'bottom-right' },
  ],
  C3: [
    { roadId: 'vC7-vD7', slot: 'right' },
    { roadId: 'vD5-vD6', slot: 'bottom-left' },
    { roadId: 'vD6-vD7', slot: 'bottom-right' },
  ],
  C4: [
    { roadId: 'vC9-vD9', slot: 'right' },
    { roadId: 'vD7-vD8', slot: 'bottom-left' },
    { roadId: 'vD8-vD9', slot: 'bottom-right' },
 ],
  C5: [
    { roadId: 'vC10-vC11', slot: 'top-right' },
    { roadId: 'vC11-vD11', slot: 'right' },
    { roadId: 'vD10-vD9', slot: 'bottom-left' },
    { roadId: 'vD10-vD11', slot: 'bottom-right' },
  ],
  D1: [
    { roadId: 'vD2-vE1', slot: 'left' },
    { roadId: 'vD4-vE3', slot: 'right' },
    { roadId: 'vE1-vE2', slot: 'bottom-left' },
    { roadId: 'vE2-vE3', slot: 'bottom-right' },
  ],

  D2: [
    { roadId: 'vD6-vE5', slot: 'right' },
    { roadId: 'vE3-vE4', slot: 'bottom-left' },
    { roadId: 'vE4-vE5', slot: 'bottom-right' },
  ],

  D3: [
    { roadId: 'vD8-vE7', slot: 'right' },
    { roadId: 'vE5-vE6', slot: 'bottom-left' },
    { roadId: 'vE6-vE7', slot: 'bottom-right' },
  ],

  D4: [
    { roadId: 'vD10-vE9', slot: 'right' },
    { roadId: 'vE7-vE8', slot: 'bottom-left' },
    { roadId: 'vE8-vE9', slot: 'bottom-right' },
  ],
  E1: [
    { roadId: 'vE2-vF1', slot: 'left' },
    { roadId: 'vE4-vF3', slot: 'right' },
    { roadId: 'vF1-vF2', slot: 'bottom-left' },
    { roadId: 'vF2-vF3', slot: 'bottom-right' },
  ],

  E2: [
    { roadId: 'vE6-vF5', slot: 'right' },
    { roadId: 'vF3-vF4', slot: 'bottom-left' },
    { roadId: 'vF4-vF5', slot: 'bottom-right' },
  ],

  E3: [
    { roadId: 'vE8-vF7', slot: 'right' },
    { roadId: 'vF5-vF6', slot: 'bottom-left' },
    { roadId: 'vF6-vF7', slot: 'bottom-right' },
  ],



};

export default roadSlots;
