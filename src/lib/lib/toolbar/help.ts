import { MatchRule } from '../matcher/matcher';
import { Commander } from '../commands/commander';

export enum HandlerType {
  Button,
  Select,
  Dropdown,
  ActionSheet
}

export interface ButtonConfig {
  type: HandlerType.Button;
  execCommand: Commander;
  label?: string;
  classes?: string[];
  tooltip?: string;
  match?: MatchRule;
}

export interface SelectConfig {
  type: HandlerType.Select;
}

export interface DropdownConfig {
  type: HandlerType.Dropdown;

}

export interface ActionSheetConfig {
  type: HandlerType.ActionSheet;

}

export type HandlerConfig = ButtonConfig | SelectConfig | DropdownConfig | ActionSheetConfig;
