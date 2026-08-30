'use strict';

/**
 * The playable classes. Single source of truth for both the server and the
 * class-picker in the browser (served via GET /api/classes).
 *
 * Stats and abilities will be added to each entry later -- keep that in mind
 * when adding fields here.
 */
const CLASSES = [
  {
    id: 'fencer',
    name: 'Fencer',
    blurb: 'Fast and precise. Trades blows up close and punishes any opening.',
  },
  {
    id: 'protector',
    name: 'Protector',
    blurb: 'Stands at the front. Soaks damage and keeps the line from breaking.',
  },
  {
    id: 'mage',
    name: 'Mage',
    blurb: 'Bends the rules with spells. High impact, but fragile.',
  },
  {
    id: 'hunter',
    name: 'Hunter',
    blurb: 'Strikes from range and controls the field with traps and beasts.',
  },
];

const CLASS_IDS = CLASSES.map((c) => c.id);

function isValidClassId(id) {
  return CLASS_IDS.includes(id);
}

function getClass(id) {
  return CLASSES.find((c) => c.id === id) || null;
}

module.exports = { CLASSES, CLASS_IDS, isValidClassId, getClass };
