type MomentFactory = (value?: unknown) => any;

function normalizeHomeDate(date: any, momentFactory: MomentFactory): any {
  return date?.clone ? date.clone().startOf('day') : momentFactory(date).startOf('day');
}

export function applyHomeDateContext(element: HTMLElement, date: any, momentFactory: MomentFactory): void {
  const selected = normalizeHomeDate(date, momentFactory);
  element.dataset.tpsContextSource = 'home';
  element.dataset.tpsContextScheduled = `${selected.format('YYYY-MM-DD')} 00:00:00`;
  element.dataset.tpsContextDate = selected.format('YYYY-MM-DD');
}
