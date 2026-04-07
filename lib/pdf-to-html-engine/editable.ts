function getEditableTextElements(root: ParentNode): HTMLElement[] {
  const elements = Array.from(
    root.querySelectorAll([
      '.pdf-page p',
      '.pdf-page span',
    ].join(','))
  ) as HTMLElement[];

  return elements.filter((element) => element.childElementCount === 0);
}

export function extractEditableTextFromHtml(portableHtml: string): string {
  if (!portableHtml) {
    return '';
  }

  const parser = new DOMParser();
  const parsed = parser.parseFromString(portableHtml, 'text/html');
  const textElements = getEditableTextElements(parsed);

  const lines = textElements.map((element) => (element.textContent ?? '').replace(/\u00A0/g, ' '));

  if (lines.length > 0) {
    return lines.join('\n');
  }

  return (parsed.body.textContent ?? '').trim();
}

export function applyEditedTextToHtml(
  basePortableHtml: string,
  editedText: string,
  showEditedText: boolean
): string {
  if (!basePortableHtml) {
    return editedText;
  }

  const parser = new DOMParser();
  const parsed = parser.parseFromString(basePortableHtml, 'text/html');
  const textElements = getEditableTextElements(parsed);

  if (textElements.length === 0) {
    return basePortableHtml;
  }

  const lines = editedText.split(/\r?\n/);

  textElements.forEach((element, index) => {
    const originalText = element.textContent ?? '';
    const nextText = lines[index] ?? '';

    element.textContent = nextText;

    if (showEditedText && nextText !== originalText) {
      element.setAttribute('data-edited', 'true');
    } else {
      element.removeAttribute('data-edited');
    }
  });

  if (showEditedText) {
    parsed.body.classList.add('show-edited-text');
  } else {
    parsed.body.classList.remove('show-edited-text');
  }

  return ['<!doctype html>', parsed.documentElement.outerHTML].join('\n');
}
