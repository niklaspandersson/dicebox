document.addEventListener('DOMContentLoaded', () => {
  function showView(id) {
    const fullId = `${id}-view`
    for(const view of document.querySelectorAll('.view')) {
      view.classList.toggle("active", fullId === view.id)
    }
  }

  function handleRoute() {
    const params = new URLSearchParams(window.location.search);

    if (params.has('create')) {
      showView('create');
    } else if (params.has('join')) {
      showView('join');
      // Pre-fill room code if provided
      const roomCode = params.get('join');
      if (roomCode && roomCode.length === 4) {
        // Will be handled by room-join component
        const joinView = document.getElementById('join-view');
        const joinComponent = joinView.querySelector('room-join');
        if (joinComponent && joinComponent.setRoomCode) {
          joinComponent.setRoomCode(roomCode);
        }
      }
    } else {
      showView('mode');
    }
  }

  // Handle initial route
  handleRoute();

  // Handle browser back/forward
  window.addEventListener('popstate', handleRoute);

  // Handle mode button clicks with proper navigation
  document.getElementById('create-mode-btn').addEventListener('click', (e) => {
    e.preventDefault();
    history.pushState({}, '', '?create');
    showView('create');
  });

  document.getElementById('join-mode-btn').addEventListener('click', (e) => {
    e.preventDefault();
    history.pushState({}, '', '?join');
    showView('join');
  });

  // Handle back links
  document.querySelectorAll('.back-to-modes').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      history.pushState({}, '', '?');
      showView('mode');
    });
  });
});
