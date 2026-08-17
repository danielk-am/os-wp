/* GENERATED from llm-editor src/editor/overview.js. Do not edit here.
   Edit the source and run: node build/sync-wp.mjs */
import { faSvg } from './icons.js';
import { SEED } from './seed.js';
import { host } from '../host/host.js';
import { repairDocument } from '../core/repair.js';
import { mdDocument } from '../core/md.js';
import { OVERVIEW_MANIFEST } from './overview-manifest.js';

const overview = document.getElementById('overview');
const projectPanel = document.getElementById('overview-project');
const projectName = document.getElementById('overview-project-name');
const projectPath = document.getElementById('overview-project-path');
const projectSkills = document.getElementById('overview-skills');
const projectEmpty = document.getElementById('overview-empty');
const status = document.getElementById('overview-status');
const hero = document.querySelector('.overview-hero');
const heroCopy = document.getElementById('overview-hero-copy');
const heroKicker = document.getElementById('overview-kicker');
const heroHeading = document.getElementById('overview-heading');
const heroSupport = document.getElementById('overview-support');
const journeyGrid = document.getElementById('overview-journeys');
const claudeCreator = document.getElementById('claude-creator');
const claudeDomain = document.getElementById('claude-domain');
const claudeMessages = document.getElementById('claude-messages');
const claudeForm = document.getElementById('claude-form');
const claudeInput = document.getElementById('claude-input');
const claudeSend = document.getElementById('claude-send');
const claudeStop = document.getElementById('claude-stop');
const claudeChatStatus = document.getElementById('claude-chat-status');
const claudeDraft = document.getElementById('claude-draft');
const claudeDraftPreview = document.getElementById('claude-draft-preview');
const claudeSaveDraft = document.getElementById('claude-save-draft');

export const HERO_VARIATIONS = OVERVIEW_MANIFEST.hero.variants;

const HERO_ROTATION_MS = 6000;
let heroIndex = 0;
let heroTimer = null;
let claudeDomainState = [];
let claudeHistory = [];
let claudeRequest = 0;
let claudeBusy = false;
let currentDraft = '';

function paintHero(index, animate = true) {
  const variation = HERO_VARIATIONS[index];
  heroKicker.textContent = variation.kicker;
  heroHeading.textContent = variation.heading;
  heroSupport.textContent = variation.support;
  hero.dataset.variation = String(index);
  if (!animate) return;
  heroCopy.classList.remove('is-entering');
  void heroCopy.offsetWidth;
  heroCopy.classList.add('is-entering');
}

function stopHeroRotation() {
  clearInterval(heroTimer);
  heroTimer = null;
}

function startHeroRotation() {
  stopHeroRotation();
  if (
    document.hidden
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) return;
  heroTimer = setInterval(() => {
    heroIndex = (heroIndex + 1) % HERO_VARIATIONS.length;
    paintHero(heroIndex);
  }, HERO_ROTATION_MS);
}

function wireHero() {
  paintHero(0, false);
  startHeroRotation();
  hero.addEventListener('mouseenter', stopHeroRotation);
  hero.addEventListener('mouseleave', startHeroRotation);
  window.addEventListener('blur', stopHeroRotation);
  window.addEventListener('focus', startHeroRotation);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopHeroRotation();
    else startHeroRotation();
  });
}

function setBusy(button, busy, message = '') {
  button.disabled = busy;
  button.classList.toggle('is-busy', busy);
  if (busy) status.textContent = message;
}

function skillRow(skill) {
  const li = document.createElement('li');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'overview-skill';
  button.innerHTML = `
    <span class="overview-skill-icon">${faSvg('skill', 16)}</span>
    <span class="overview-skill-copy">
      <strong>${escapeHtml(skill.name)}</strong>
      <code>${escapeHtml(skill.relative)}</code>
    </span>
    <span class="overview-skill-open" aria-hidden="true">Open</span>
  `;
  button.addEventListener('click', async () => {
    setBusy(button, true);
    try { await host().openSkill?.(skill.relative); }
    finally { setBusy(button, false); }
  });
  li.appendChild(button);
  return li;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function renderProject(state) {
  const active = Boolean(state?.path);
  projectPanel.hidden = !active;
  if (!active) return;

  projectName.textContent = state.name || 'Project';
  projectPath.textContent = state.path;
  projectSkills.innerHTML = '';
  for (const skill of state.skills || []) projectSkills.appendChild(skillRow(skill));
  projectEmpty.hidden = Boolean(state.skills?.length);

  document.getElementById('doc-name').textContent = state.name || 'Overview';
}

async function runJourney(button, journey, action) {
  setBusy(button, true, journey.states.busy);
  try {
    const state = await action();
    if (state?.path) renderProject(state);
    if (state?.workspace === 'assistant-workspace') await openClaudeCreator();
    status.textContent = '';
  } catch (error) {
    console.error('llm-editor: overview journey failed', error);
    status.textContent = error.message || journey.states.error;
  } finally {
    setBusy(button, false);
  }
}

function wireJourney(journey, action, buttonId = `journey-${journey.id}`) {
  const button = document.getElementById(buttonId);
  if (!action) {
    button.disabled = true;
    button.title = journey.states.unavailable;
    return;
  }
  button.addEventListener('click', () => void runJourney(button, journey, action));
}

const JOURNEY_ICONS = {
  'create-project': 'plus',
  'open-project': 'group',
  'draft-with-assistant': 'skill',
};

function journeyCard(journey) {
  const button = document.createElement('button');
  button.type = 'button';
  button.id = `journey-${journey.id}`;
  button.className = `journey-card${journey.emphasis === 'primary' ? ' is-primary' : ''}`;
  button.dataset.capability = journey.capability;

  const top = document.createElement('span');
  top.className = 'journey-top';
  const icon = document.createElement('span');
  icon.className = 'journey-icon';
  icon.innerHTML = faSvg(JOURNEY_ICONS[journey.capability] || 'skill', 18);
  const order = document.createElement('span');
  order.className = 'journey-step';
  order.textContent = String(journey.order).padStart(2, '0');
  top.append(icon, order);

  const title = document.createElement('strong');
  title.textContent = journey.title;
  const promise = document.createElement('span');
  promise.textContent = journey.promise;
  const path = document.createElement('code');
  path.textContent = journey.path.join(' → ');
  button.append(top, title, promise, path);
  return button;
}

function renderOverviewDefinition() {
  journeyGrid.replaceChildren(
    ...OVERVIEW_MANIFEST.journeys.map(journeyCard)
  );
}

function claudeMessage(role, text) {
  const message = document.createElement('div');
  message.className = `claude-message is-${role}`;
  message.innerHTML = mdDocument(text);
  claudeMessages.appendChild(message);
  claudeMessages.scrollTop = claudeMessages.scrollHeight;
}

function selectedClaudeDomain() {
  return claudeDomainState.find(domain => domain.id === claudeDomain.value);
}

function updateClaudeControls() {
  const selected = selectedClaudeDomain();
  claudeSend.disabled = claudeBusy || !selected?.available;
  claudeStop.hidden = !claudeBusy;
  claudeInput.disabled = claudeBusy;
  claudeDomain.disabled = claudeBusy || claudeDomainState.length < 2;
  if (!claudeBusy && selected && !selected.available) {
    claudeChatStatus.textContent = `${selected.provider} ${selected.label} Bridge is not running.`;
  }
}

function setClaudeBusy(busy) {
  claudeBusy = busy;
  if (busy) claudeChatStatus.textContent = 'Claude is drafting…';
  updateClaudeControls();
}

async function loadClaudeDomains() {
  const previous = claudeDomain.value;
  claudeDomain.innerHTML = '';
  claudeChatStatus.textContent = 'Checking domain Bridges…';
  try {
    claudeDomainState = await host().claudeDomains?.() || [];
    for (const domain of claudeDomainState) {
      const option = document.createElement('option');
      option.value = domain.id;
      option.textContent = `${domain.provider} · ${domain.label} Bridge${domain.available ? '' : ' · unavailable'}`;
      claudeDomain.appendChild(option);
    }
    if (!claudeDomainState.length) {
      const option = document.createElement('option');
      option.textContent = 'No domain Bridges configured';
      claudeDomain.appendChild(option);
    }
    const available = claudeDomainState.find(domain => domain.available);
    const selected = claudeDomainState.find(domain => domain.id === previous && domain.available)
      || available;
    if (selected) {
      claudeDomain.value = selected.id;
      claudeChatStatus.textContent = `Ready through ${selected.provider} ${selected.label} Bridge.`;
    }
  } catch (error) {
    claudeChatStatus.textContent = error.message || 'Could not inspect the domain Bridges.';
  }
  updateClaudeControls();
}

async function openClaudeCreator() {
  claudeCreator.hidden = false;
  if (!claudeMessages.childElementCount) {
    claudeMessage(
      'assistant',
      'Tell me what the skill should teach, when it should trigger, and what a good result looks like.'
    );
  }
  await loadClaudeDomains();
  claudeCreator.scrollIntoView({ behavior: 'smooth', block: 'start' });
  claudeInput.focus();
}

function extractLlmDraft(text) {
  const fenced = String(text).match(/```llm[^\n]*\n([\s\S]*?)```/i);
  if (!fenced) return '';
  return `${fenced[1].trim()}\n`;
}

function showClaudeDraft(text) {
  const extracted = extractLlmDraft(text);
  if (!extracted) return;
  const repaired = repairDocument(extracted);
  currentDraft = repaired.text;
  claudeDraftPreview.textContent = currentDraft;
  claudeDraft.hidden = false;
  if (repaired.warnings.length) {
    claudeChatStatus.textContent = `Review needed: ${repaired.warnings.join(' ')}`;
  } else if (repaired.changes.length) {
    claudeChatStatus.textContent = `Draft repaired: ${repaired.changes.join('; ')}.`;
  } else {
    claudeChatStatus.textContent = 'Draft ready for review and saving.';
  }
}

async function sendClaudeMessage() {
  const content = claudeInput.value.trim();
  const domain = selectedClaudeDomain();
  if (!content || claudeBusy || !domain?.available) return;

  claudeInput.value = '';
  claudeHistory.push({ role: 'user', content });
  claudeMessage('user', content);
  const request = ++claudeRequest;
  setClaudeBusy(true);
  try {
    const reply = await host().claudeChat?.({
      domain: domain.id,
      messages: claudeHistory,
    });
    if (request !== claudeRequest || typeof reply !== 'string') return;
    claudeHistory.push({ role: 'assistant', content: reply });
    claudeMessage('assistant', reply);
    claudeChatStatus.textContent = 'Claude replied.';
    showClaudeDraft(reply);
  } catch (error) {
    if (request !== claudeRequest) return;
    console.error('llm-editor: Claude Bridge request failed', error);
    claudeChatStatus.textContent = error.message || 'Claude could not reply.';
  } finally {
    if (request === claudeRequest) setClaudeBusy(false);
  }
}

function wireClaudeCreator() {
  claudeForm.addEventListener('submit', event => {
    event.preventDefault();
    void sendClaudeMessage();
  });
  claudeInput.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      claudeForm.requestSubmit();
    }
  });
  claudeDomain.addEventListener('change', updateClaudeControls);
  document.getElementById('claude-close').addEventListener('click', async () => {
    if (claudeBusy) {
      claudeRequest++;
      await host().cancelClaudeChat?.();
      setClaudeBusy(false);
    }
    claudeCreator.hidden = true;
  });
  claudeStop.addEventListener('click', async () => {
    claudeRequest++;
    await host().cancelClaudeChat?.();
    setClaudeBusy(false);
    claudeChatStatus.textContent = 'Stopped. Your conversation is still here.';
  });
  claudeSaveDraft.addEventListener('click', async () => {
    if (!currentDraft) return;
    claudeSaveDraft.disabled = true;
    claudeChatStatus.textContent = 'Waiting for a save location…';
    try {
      const saved = await host().saveSkillDraft?.({ text: currentDraft });
      claudeChatStatus.textContent = saved
        ? 'Skill saved and opened in a new tab.'
        : 'Save cancelled. The draft is still here.';
    } catch (error) {
      claudeChatStatus.textContent = error.message || 'The skill could not be saved.';
    } finally {
      claudeSaveDraft.disabled = false;
    }
  });
}

let wired = false;
function wireOverview() {
  if (wired) return;
  wired = true;

  renderOverviewDefinition();
  document.getElementById('overview-refresh-icon').innerHTML = faSvg('restore', 13);
  document.getElementById('overview-new-skill-icon').innerHTML = faSvg('plus', 13);
  wireHero();

  for (const journey of OVERVIEW_MANIFEST.journeys) {
    const available = host().canInvokeOverview?.(journey.capability) !== false
      && typeof host().invokeOverview === 'function';
    wireJourney(
      journey,
      available ? () => host().invokeOverview(journey.capability) : null
    );
  }
  const newSkill = {
    id: 'overview-new-skill',
    states: { busy: 'Creating the skill…', error: 'The skill could not be created.' },
  };
  const refresh = {
    id: 'overview-refresh',
    states: { busy: 'Refreshing the project…', error: 'The project could not be refreshed.' },
  };
  wireJourney(newSkill, () => host().createSkill?.(SEED), 'overview-new-skill');
  wireJourney(refresh, () => host().refreshProject?.(), 'overview-refresh');
  wireClaudeCreator();
}

export async function mountOverview() {
  wireOverview();
  document.body.classList.add('overview-active');
  overview.hidden = false;
  document.getElementById('doc-name').textContent = 'Overview';
  document.getElementById('doc-ext').textContent = '';
  host().onProjectChange?.(renderProject);
  renderProject(await host().projectState?.());
}

// File → New Skill uses the same journey from any Electron tab. Keeping the
// seed here avoids a second frontmatter template in the native main process.
window.addEventListener('llm:create-skill', () => {
  void host().createSkill?.(SEED);
});
