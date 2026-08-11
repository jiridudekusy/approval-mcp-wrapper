const parameters = new URLSearchParams(window.location.search);
const action = parameters.get('action') ?? 'open';
const messageId = parameters.get('messageId') ?? 'unknown';
const mode = parameters.get('mode') ?? 'text';
const content = parameters.get('content') ?? '';

document.querySelector('#selected-action').textContent = action;
document.querySelector('#message-id').textContent = `Message ID: ${messageId}`;

const output = document.querySelector('#detail-output');
if (mode === 'json') {
  renderJson(output, content);
} else if (mode === 'key-value') {
  renderKeyValue(output, content);
} else {
  const paragraph = document.createElement('p');
  paragraph.className = 'preserve-lines';
  paragraph.textContent = content || 'Bez detailního obsahu.';
  output.append(paragraph);
}

function renderJson(target, value) {
  const pre = document.createElement('pre');
  try {
    pre.textContent = JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    pre.textContent = value || 'Bez detailního obsahu.';
    pre.classList.add('invalid-content');
  }
  target.append(pre);
}

function renderKeyValue(target, value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = Object.fromEntries(
      value
        .split('\n')
        .map((line) => line.split(/:(.*)/s).slice(0, 2).map((part) => part.trim()))
        .filter(([key]) => key),
    );
  }

  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    renderJson(target, value);
    return;
  }

  const list = document.createElement('dl');
  list.className = 'key-value-list';
  for (const [key, item] of Object.entries(parsed)) {
    const term = document.createElement('dt');
    term.textContent = key;
    const description = document.createElement('dd');
    description.textContent = typeof item === 'string' ? item : JSON.stringify(item);
    list.append(term, description);
  }
  target.append(list);
}
