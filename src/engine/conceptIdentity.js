/** Canonicalize only explicit names or unambiguous definitions; never merge a whole objective. */
export function conceptName(topic = '', keyed = '') {
  const text = String(topic).trim();
  const definitions = [
    ['Projection', /attribut\w* (?:one.s |own |one.s own )?(?:unwanted trait|infidelity|unacceptable (?:feelings|impulses)) to another/i],
    ['Sublimation', /channel\w* negative emotions into constructive activity/i],
    ['Displacement', /displacement toward substitute targets/i],
  ];
  for (const [name, pattern] of definitions) if (pattern.test(text)) return name;
  for (const name of ['Projection', 'Sublimation', 'Displacement']) {
    if (new RegExp(`^${name}[.!]?$`, 'i').test(text) || new RegExp(`^${name}[.!]?$`, 'i').test(String(keyed).trim())) return name;
  }
  return text || 'Unspecified concept';
}
export const conceptKey = (topic, keyed) => conceptName(topic, keyed).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
