const axios = require('axios');
const cheerio = require('cheerio');

async function scrapeLodestoneFreeCompany(fcId) {
  if (!fcId) throw new Error('Missing FC Lodestone ID');
  const url = `https://na.finalfantasyxiv.com/lodestone/freecompany/${fcId}/`;
  const { data } = await axios.get(url, { headers: { 'User-Agent': 'FCBot/1.0' } });
  const $ = cheerio.load(data);

  const name = $('h2.heading__name').first().text().trim() || $('title').text().trim();
  const tag = $('.character__name').first().text().trim();

  return { name, tag, url };
}

async function scrapeCharacterName(characterId) {
  if (!characterId) throw new Error('Missing character ID');
  const url = `https://na.finalfantasyxiv.com/lodestone/character/${characterId}/#profile`;
  const { data } = await axios.get(url, { headers: { 'User-Agent': 'FCBot/1.0' } });
  const $ = cheerio.load(data);
  // Primary selector reported by user
  let name = $('p.frame__chara__name').first().text().trim();
  if (!name) {
    // Fallbacks
    name = $('h2.heading__name').first().text().trim() || $('title').text().replace(/\s*-\s*FINAL FANTASY XIV.*$/i, '').trim();
  }
  return { name: name || null, url };
}

async function scrapeFreeCompanyMembers(fcId) {
  if (!fcId) throw new Error('Missing FC Lodestone ID');
  const base = `https://na.finalfantasyxiv.com/lodestone/freecompany/${fcId}/member/`;
  const members = [];
  // paginate pages until no results or cap reached
  for (let page = 1; page <= 20; page++) {
    const url = `${base}?page=${page}`;
    const { data } = await axios.get(url, { headers: { 'User-Agent': 'FCBot/1.0' } });
    const $ = cheerio.load(data);
    const entries = $('li.entry');
    if (entries.length === 0) break;
    entries.each((_, el) => {
      const $el = $(el);
      const name = $el.find('p.entry__name, p.entry_name').first().text().trim();
      const href = $el.find('a.entry__bg, a').attr('href') || '';
      const match = href.match(/\/lodestone\/character\/(\d+)\//);
      const lodestoneId = match ? match[1] : null;
      let rankName = $el.find('.entry__freecompany__info li span').first().text().trim();
      if (!rankName) {
        rankName = $el.find('.entry__freecompany__info span').first().text().trim();
      }
      if (lodestoneId) {
        members.push({ lodestone_id: lodestoneId, member_name: name || null, rank_name: rankName || null });
      }
    });
  }
  return { url: base, members };
}

module.exports = { scrapeLodestoneFreeCompany, scrapeCharacterName, scrapeFreeCompanyMembers };
