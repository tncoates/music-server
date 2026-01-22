document.getElementById('save').onclick = async () => {
  const form = new FormData();

  form.append('audio', document.getElementById('audio').files[0]);
  form.append('cover', document.getElementById('cover').files[0]);
  form.append('title', document.getElementById('title').value);
  form.append('artist', document.getElementById('artist').value);
  form.append('album', document.getElementById('album').value);

  const res = await fetch('/api/edit-metadata', {
    method: 'POST',
    body: form
  });

  const data = await res.json();

  const link = document.getElementById('download');
  link.href = data.downloadUrl;
  link.style.display = 'inline';
};


const form = document.getElementById("editorForm");
const download = document.getElementById("download");

document.getElementById("clear").onclick = () => {
  form.reset();                // clears inputs
  download.style.display = "none";
};

