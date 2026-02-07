const faqList = document.getElementById('faq-list');

if (faqList) {
  faqList.addEventListener('click', (event) => {
    const question = event.target.closest('.faq-question');
    if (!question || !faqList.contains(question)) {
      return;
    }

    const item = question.closest('.faq-item');
    if (item) {
      item.classList.toggle('open');
    }
  });
}
