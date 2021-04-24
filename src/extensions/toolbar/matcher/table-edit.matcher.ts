import { TBSelection } from '../../../lib/core/_api';
import { Matcher, SelectionMatchState } from './matcher';
import { HighlightState } from '../help';
import { rangeContentInComponent } from './utils/range-content-in-component';
import { TableComponent } from '../../../lib/components/table.component';

export class TableEditMatcher implements Matcher {

  queryState(selection: TBSelection): SelectionMatchState {
    for (const range of selection.ranges) {
      const has = rangeContentInComponent(range, [TableComponent]);
      if (!has) {
        return {
          state: HighlightState.Disabled,
          matchData: null,
          srcStates: []
        };
      }
    }
    return {
      srcStates: [],
      matchData: null,
      state: HighlightState.Normal
    }
  }
}