const form = document.querySelector('#adminLoginForm');
const errorBox = document.querySelector('#adminLoginError');

if (new URLSearchParams(window.location.search).get('error') === 'admin-only') {
  errorBox.textContent = 'This account does not have administrator access.';
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  errorBox.textContent = '';
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const response = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.elements.email.value, password: form.elements.password.value })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not sign in.');
    window.location.assign('/admin');
  } catch (error) {
    errorBox.textContent = error.message || 'The server could not be reached.';
  } finally {
    button.disabled = false;
  }
});
