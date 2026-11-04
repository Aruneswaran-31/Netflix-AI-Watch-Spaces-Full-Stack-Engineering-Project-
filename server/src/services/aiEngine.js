'use strict';

/**
 * AI Content Engine — retrieval-grounded Q&A.
 *
 * Design rules (PRD §6.2, §15.1):
 *  1. Every answer is produced from retrieved, authored timeline entries.
 *  2. Every answer cites the entry ids it used; callers can render them.
 *  3. If retrieval finds nothing relevant the engine declines instead of
 *     answering from general knowledge.
 *  4. An optional OpenAI-compatible LLM may phrase the answer, but its output is
 *     validated against the retrieved ids and falls back deterministically.
 */

const config = require('../config/env');
const { createLogger } = require('../lib/logger');

const log = createLogger('ai');

const STOPWORDS = new Set(
  `a an the is are was were be been being am do does did doing have has had having i me my we our you your he him his she her it its they them their this that these those who whom whose what which when where why how of in on at to for from with without and or but not no so than then there here about into over under again further once all any both each few more most other some such only own same too very can could should would will shall may might must just now also get got tell say says said know`.split(
    /\s+/
  )
);

const INTENT_BOOSTS = {
  who: { character: 1.1, beat: 0.2, trivia: 0.1 },
  glossary: { glossary: 1.4, trivia: 0.1 },
  variation: { variation_point: 1.6, beat: 0.1 },
  when: { beat: 0.3, trivia: 0.25, character: 0.2 },
  generic: { trivia: 0.3, beat: 0.2, character: 0.15, glossary: 0.15 },
};

function tokenize(text = '') {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .map((word) => word.replace(/^['-]+|['-]+$/g, ''))
    .filter((word) => word.length > 1 && !STOPWORDS.has(word))
    .map((word) => (word.length > 4 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word));
}

function detectIntent(question = '') {
  const q = question.toLowerCase();
  if (/\b(who|character|actor|actress|cast|protagonist|villain)\b/.test(q)) return 'who';
  if (/\b(mean|meaning|definition|term|glossary|translate|what does)\b/.test(q)) return 'glossary';
  if (/\b(variation|alternate|alternative|subtitle|locali[sz]|vote|ending|version)\b/.test(q)) {
    return 'variation';
  }
  if (/\b(when|what time|timestamp|how long|how far)\b/.test(q)) return 'when';
  return 'generic';
}

function formatTs(seconds) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function entryHaystack(event) {
  return [
    event.title || '',
    event.text || '',
    event.scene || '',
    event.character || '',
    event.term || '',
    event.definition || '',
    ...(event.tags || []),
    ...(event.options || []).map((option) => `${option.label} ${option.description || ''}`),
  ]
    .join(' ')
    .toLowerCase();
}

function buildCorpus(title) {
  const entries = [];
  const titleEntry = {
    id: `title:${title._id || title.id}`,
    ts: 0,
    type: 'title',
    title: title.name,
    text: `${title.name} (${title.year || 'n.d.'}) — ${title.synopsis || ''}`.trim(),
    tags: [...(title.genres || []), ...tokenize(title.name)],
    timeless: true,
  };
  entries.push(titleEntry);

  for (const event of title.timeline || []) {
    const type = event.type === 'variation_point' ? 'variation_point' : event.type;
    const parts = [];
    if (event.character) parts.push(`${event.character} appears.`);
    if (event.definition) parts.push(`${event.term}: ${event.definition}`);
    if (event.text) parts.push(event.text);
    if (type === 'variation_point' && event.options?.length) {
      parts.push(`Pre-approved options: ${event.options.map((o) => o.label).join('; ')}.`);
    }
    const text = parts.join(' ').replace(/\s+/g, ' ').trim();
    entries.push({
      id: event.id,
      ts: event.ts,
      endTs: event.endTs,
      type,
      title: event.title || '',
      text,
      scene: event.scene || '',
      character: event.character || '',
      term: event.term || '',
      definition: event.definition || '',
      tags: event.tags || [],
      options: event.options,
      priority: event.priority,
      timeless: type === 'glossary',
    });
  }

  for (const entry of entries) {
    entry.haystack = entryHaystack(entry);
    entry.tf = {};
    for (const term of tokenize(entry.haystack)) {
      entry.tf[term] = (entry.tf[term] || 0) + 1;
    }
    for (const tag of entry.tags || []) {
      for (const term of tokenize(tag)) entry.tf[term] = (entry.tf[term] || 0) + 2;
    }
  }

  const df = {};
  for (const entry of entries) {
    for (const term of Object.keys(entry.tf)) df[term] = (df[term] || 0) + 1;
  }
  const idf = {};
  for (const [term, count] of Object.entries(df)) {
    idf[term] = Math.log((entries.length + 1) / (count + 1)) + 1;
  }
  return { entries, idf };
}

function questionPhrases(question) {
  const tokens = String(question).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const phrases = [];
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const phrase = `${tokens[i]} ${tokens[i + 1]}`;
    if (phrase.length >= 8) phrases.push(phrase);
  }
  return phrases.slice(0, 6);
}

/**
 * Rank authored metadata for a question at a playhead. Pure and synchronous so
 * it can be unit-tested without a DB or socket.
 */
function retrieveContext({
  title,
  question,
  currentTs = 0,
  limit = config.ai.maxSources,
  lookbackSeconds = config.ai.lookbackSeconds,
  lookaheadSeconds = config.ai.lookaheadSeconds,
  minScore = config.ai.minScore,
  minCoverage = config.ai.minCoverage,
}) {
  const corpus = buildCorpus(title);
  const intent = detectIntent(question);
  const queryTerms = [...new Set(tokenize(question))];
  const phrases = questionPhrases(question);
  const boosts = INTENT_BOOSTS[intent] || INTENT_BOOSTS.generic;
  const scored = [];

  for (const entry of corpus.entries) {
    if (!entry.timeless) {
      if (entry.ts > currentTs + lookaheadSeconds) continue;
      if (entry.ts < currentTs - lookbackSeconds) continue;
    }

    let score = 0;
    const matchedTerms = [];
    for (const term of queryTerms) {
      const tf = entry.tf[term] || 0;
      if (!tf) continue;
      matchedTerms.push(term);
      score += (corpus.idf[term] || 1) * (1 + Math.min(tf, 4) * 0.35);
    }
    // No lexical overlap means the entry cannot support an answer, even for
    // timeless glossary rows: otherwise every question would cite them.
    if (matchedTerms.length === 0) continue;

    for (const phrase of phrases) {
      if (entry.haystack.includes(phrase)) score += 1.1;
    }

    score += boosts[entry.type] || 0;
    if (entry.type === 'character' && entry.endTs && currentTs >= entry.ts && currentTs <= entry.endTs) {
      score += 0.4;
    }

    const delta = currentTs - entry.ts;
    if (entry.timeless) score += 0.35;
    else if (delta >= 0) score += 0.9 * Math.exp(-delta / 420);
    else score += 0.2;

    if (entry.priority === 'high') score += 0.15;

    if (score > 0) {
      scored.push({ entry, score: Number(score.toFixed(3)), matchedTerms });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.entry.ts - b.entry.ts);
  const top = scored.slice(0, limit);
  const bestScore = top[0]?.score || 0;
  // A single incidental word overlap ("world" in an unrelated question) must
  // not count as grounding: require the best entry to cover enough of the
  // question's content terms as well as clearing the score floor.
  const bestCoverage =
    queryTerms.length > 0 ? (top[0]?.matchedTerms.length || 0) / queryTerms.length : 0;
  // A question phrased with an explicit domain intent ("is there an alternate
  // subtitle version?") legitimately matches on one salient term, so allow an
  // intent-aligned entry to ground the answer even when coverage is low.
  const bestType = top[0]?.entry.type;
  const intentAligned =
    (intent === 'who' && bestType === 'character') ||
    (intent === 'glossary' && bestType === 'glossary') ||
    (intent === 'variation' && bestType === 'variation_point') ||
    (intent === 'when' && (bestType === 'beat' || bestType === 'trivia'));
  const grounded = bestScore >= minScore && (bestCoverage >= minCoverage || intentAligned);

  return {
    intent,
    queryTerms,
    bestScore,
    bestCoverage: Number(bestCoverage.toFixed(3)),
    grounded,
    sources: grounded
      ? top.map(({ entry, score, matchedTerms }) => ({
          id: entry.id,
          ts: entry.ts,
          tsSeconds: entry.ts,
          type: entry.type,
          title: entry.title,
          text: entry.text,
          character: entry.character,
          term: entry.term,
          definition: entry.definition,
          scene: entry.scene,
          options: entry.options?.map((o) => ({ id: o.id, label: o.label })),
          score,
          matchedTerms,
        }))
      : [],
    considered: scored.length,
  };
}

function composeDeterministicAnswer({ title, question, currentTs, intent, sources }) {
  const usable = sources.slice(0, 3);
  const sentences = [];

  for (const source of usable) {
    if (intent === 'who' && source.type === 'character' && source.character) {
      const detail = (source.text || '')
        .replace(/^[A-Z][\w' ]+ appears\.\s*/, '')
        .replace(new RegExp(`^${source.character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[—–-]\\s*`, 'i'), '')
        .trim();
      const capitalised = detail ? `${detail.charAt(0).toUpperCase()}${detail.slice(1)}` : '';
      sentences.push(
        capitalised ? `That's ${source.character}. ${capitalised}` : `That's ${source.character}.`
      );
      continue;
    }
    if (intent === 'glossary' && source.type === 'glossary' && source.term) {
      sentences.push(`${source.term} — ${source.definition}`);
      continue;
    }
    if (source.type === 'variation_point' && source.options?.length) {
      sentences.push(
        `At ${formatTs(source.ts)} there's an authored variation point with ${source.options.length} approved options: ${source.options
          .map((o) => o.label)
          .join(' / ')}.`
      );
      continue;
    }
    if (source.type === 'title') {
      sentences.push(`${source.text}`);
      continue;
    }
    const prefix = source.type === 'trivia' ? '' : `At ${formatTs(source.ts)}, `;
    const text = source.text || '';
    if (text) sentences.push(`${prefix}${text.charAt(0).toLowerCase()}${text.slice(1)}`);
  }

  const seen = new Set();
  const deduped = sentences.filter((sentence) => {
    const key = sentence.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const answer = deduped.slice(0, 3).join(' ').trim();
  return answer || hedgeAnswer({ title, currentTs, question });
}

function hedgeAnswer({ title, currentTs }) {
  return `I can only answer from the authored timeline for "${title.name}", and I don't have an entry covering that around ${formatTs(
    currentTs
  )}. Try asking about a character on screen, a term you heard, or what just happened.`;
}

function buildLlmMessages({ title, question, currentTs, sources }) {
  const context = sources
    .map(
      (source) =>
        `[${source.id}] (${formatTs(source.ts)} · ${source.type}) ${source.character ? `${source.character}: ` : ''}${source.text}`
    )
    .join('\n');
  return [
    {
      role: 'system',
      content: [
        `You are the AI Co-Pilot inside a synchronized watch party for "${title.name}" (${title.year || 'n.d.'}).`,
        `The playhead is at ${formatTs(currentTs)}.`,
        'Answer ONLY from the CONTEXT entries supplied. Never use outside knowledge, never invent names, dates or plot facts.',
        'If the context cannot answer the question, set grounded to false, citations to [] and say briefly that the title metadata does not cover it.',
        'Return strict JSON: {"answer": string, "citationIds": string[], "grounded": boolean}. Answer in at most 3 sentences.',
        'citationIds must be ids copied exactly from the CONTEXT entries you used.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `CONTEXT:\n${context}\n\nQUESTION: ${question}`,
    },
  ];
}

async function callLlm({ title, question, currentTs, sources }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.ai.timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(`${config.ai.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.ai.key}`,
      },
      body: JSON.stringify({
        model: config.ai.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: buildLlmMessages({ title, question, currentTs, sources }),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`AI provider responded ${response.status}`);
    }
    const payload = await response.json();
    const raw = payload.choices?.[0]?.message?.content;
    const cleaned = String(raw || '')
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/, '')
      .trim();
    const parsed = JSON.parse(cleaned);
    const validIds = new Set(sources.map((source) => source.id));
    const citations = Array.isArray(parsed.citationIds)
      ? parsed.citationIds.filter((id) => validIds.has(id))
      : [];
    if (typeof parsed.answer !== 'string' || !parsed.answer.trim()) {
      throw new Error('AI provider returned an empty answer');
    }
    if (parsed.grounded !== false && citations.length === 0) {
      throw new Error('AI provider answer was not grounded in any cited entry');
    }
    return {
      answer: parsed.answer.trim(),
      grounded: parsed.grounded !== false && citations.length > 0,
      citationIds: citations,
      provider: config.ai.provider,
      latencyMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask the co-pilot. Returns { answer, grounded, sources, sourceEvents, ... }.
 * Never throws for a well-formed question: a provider failure degrades to the
 * deterministic grounded synthesizer.
 */
async function askCoPilot({ title, question, currentTs = 0 }) {
  const started = Date.now();
  const retrieval = retrieveContext({ title, question, currentTs });

  if (!retrieval.grounded) {
    return {
      answer: hedgeAnswer({ title, currentTs }),
      grounded: false,
      sources: [],
      sourceEvents: [],
      provider: 'none',
      confidence: 0,
      retrievalScore: retrieval.bestScore,
      retrievedCount: retrieval.considered,
      latencyMs: Date.now() - started,
      generatedAt: new Date().toISOString(),
    };
  }

  let result = null;
  let degraded = false;
  if (config.ai.enabled) {
    try {
      result = await callLlm({ title, question, currentTs, sources: retrieval.sources });
    } catch (error) {
      degraded = true;
      log.warn('llm_fallback', { message: error.message });
    }
  }

  if (!result) {
    result = {
      answer: composeDeterministicAnswer({
        title,
        question,
        currentTs,
        intent: retrieval.intent,
        sources: retrieval.sources,
      }),
      grounded: true,
      citationIds: retrieval.sources.slice(0, 3).map((source) => source.id),
      provider: 'grounded-synthesizer',
      latencyMs: Date.now() - started,
    };
  }

  const cited = result.citationIds.length
    ? retrieval.sources.filter((source) => result.citationIds.includes(source.id))
    : retrieval.sources.slice(0, 3);

  return {
    answer: result.answer,
    grounded: result.grounded,
    sources: cited,
    sourceEvents: cited.map((source) => source.id),
    provider: result.provider,
    degraded,
    confidence: Number(Math.min(0.99, 0.4 + retrieval.bestScore / 10).toFixed(2)),
    retrievalScore: retrieval.bestScore,
    retrievedCount: retrieval.considered,
    latencyMs: result.latencyMs ?? Date.now() - started,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  askCoPilot,
  retrieveContext,
  buildCorpus,
  composeDeterministicAnswer,
  detectIntent,
  tokenize,
  formatTs,
  hedgeAnswer,
};
