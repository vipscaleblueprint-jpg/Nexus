/**
 * The app's standard compact calendar (react-day-picker), first used for "Set Due Date"
 * in the task modal. Wrap a <DayPicker> in `.kanban-date-picker` and render this CSS
 * once inside it so every date picker in Nexus looks the same.
 */
export const KANBAN_DATE_PICKER_CSS = `
  .kanban-date-picker .rdp-root {
    --rdp-accent-color: #6366f1;
    --rdp-accent-background-color: rgba(99, 102, 241, 0.2);
    --rdp-day-height: 26px; --rdp-day-width: 26px;
    --rdp-day_button-height: 24px; --rdp-day_button-width: 24px;
    --rdp-day_button-border-radius: 4px;
    --rdp-selected-border: none;
    --rdp-nav-height: 24px;
    --rdp-nav_button-height: 20px; --rdp-nav_button-width: 20px;
    --rdp-weekday-padding: 2px 0;
    margin: 0; font-size: 11px;
  }
  .kanban-date-picker .rdp-months, .kanban-date-picker .rdp-month { max-width: 100%; }
  .kanban-date-picker .rdp-month_grid { margin: 0 auto; border-collapse: separate; border-spacing: 1px; }
  .kanban-date-picker .rdp-month_caption { height: var(--rdp-nav-height); color: var(--foreground); padding-left: 4px; }
  .kanban-date-picker .rdp-caption_label { font-size: 12px; font-weight: 600; }
  .kanban-date-picker .rdp-weekday { color: var(--muted-foreground); font-weight: 600; font-size: 10px; }
  .kanban-date-picker .rdp-day { font-size: 11px; padding: 0; color: var(--foreground); }
  .kanban-date-picker .rdp-day_button { transition: background-color 0.15s; }
  .kanban-date-picker .rdp-day_button:hover:not([disabled]) { background-color: var(--hover-subtle); }
  .kanban-date-picker .rdp-today:not(.rdp-outside) { color: var(--primary, #818cf8); font-weight: 700; }
  .kanban-date-picker .rdp-selected .rdp-day_button { background-color: var(--rdp-accent-color); color: white; font-weight: 700; }
  .kanban-date-picker .rdp-range_middle .rdp-day_button { background-color: var(--rdp-accent-background-color); color: var(--foreground); font-weight: 500; }
  .kanban-date-picker .rdp-button_previous, .kanban-date-picker .rdp-button_next { border-radius: 4px; }
  .kanban-date-picker .rdp-button_previous:hover, .kanban-date-picker .rdp-button_next:hover { background-color: var(--hover-subtle); }
  .kanban-date-picker .rdp-chevron { fill: var(--foreground); width: 12px; height: 12px; }
`;
