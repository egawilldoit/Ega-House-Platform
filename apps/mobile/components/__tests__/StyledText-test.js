import * as React from 'react';
import renderer, { act } from 'react-test-renderer';

import { MonoText } from '../StyledText';

jest.mock('../useColorScheme', () => ({
  useColorScheme: () => 'light',
}));

it('renders mono text with the SpaceMono font', () => {
  let component;

  act(() => {
    component = renderer.create(<MonoText>Test text</MonoText>);
  });

  const tree = component.toJSON();

  expect(tree.children).toEqual(['Test text']);
  expect(tree.props.style).toEqual(
    expect.arrayContaining([
      expect.arrayContaining([{ fontFamily: 'SpaceMono' }]),
    ])
  );
});
