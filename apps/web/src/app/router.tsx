import { createBrowserRouter } from 'react-router';
import { HomePlaceholder } from './home-placeholder';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <HomePlaceholder />,
  },
]);
