import { useState } from 'react';

export const useNavigate = () => {
  const [, setPath] = useState(window.location.pathname);

  const navigate = (path: string) => {
    window.history.pushState({}, '', path);
    setPath(path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  return { navigate };
};
