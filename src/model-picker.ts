export type ModelPickerState = {
  hidden: boolean;
  options: string[];
  selected: string;
};

export function modelPickerState(
  models: string[],
  current: string,
): ModelPickerState {
  return {
    hidden: models.length === 0,
    options: models,
    selected: models.includes(current) ? current : "",
  };
}
