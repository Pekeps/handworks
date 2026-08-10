import { basic, blendPoses, HandStage, isTwoHandPose, shadow } from 'handworks';

const stage = new HandStage({ container: document.getElementById('stage')! });
await stage.addHand({ side: 'right' });
stage.shadowTheater({});
// view from the side so lamp → hand → wall reads clearly
stage.camera.position.set(0.55, 0.15, 0.8);
stage.controls?.target.set(0, 0.05, -0.1);

let current = 'dog';
await stage.pose('shadow.dog', { duration: 600 });
const figuresDiv = document.getElementById('figures')!;
for (const name of Object.keys(shadow)) {
  const btn = document.createElement('button');
  btn.textContent = name;
  btn.addEventListener('click', async () => {
    current = name;
    await stage.pose(`shadow.${name}`, { duration: 500, stagger: 0.2 });
  });
  figuresDiv.appendChild(btn);
}

const silhouetteBox = document.getElementById('silhouette') as HTMLInputElement;
silhouetteBox.addEventListener('change', () => {
  stage.shadowTheater({ silhouette: silhouetteBox.checked });
});

// animate: dog barks (jaw open/close); other figures breathe subtly
let animating = false;
document.getElementById('animate')!.addEventListener('click', async () => {
  if (animating) {
    animating = false;
    return;
  }
  animating = true;
  while (animating) {
    if (current === 'dog' || current === 'dogBark' || current === 'wolf') {
      await stage.pose('shadow.dogBark', { duration: 260 });
      await stage.pose(`shadow.${current === 'dogBark' ? 'dog' : current}`, { duration: 260 });
    } else {
      const base = shadow[current]!;
      if (isTwoHandPose(base)) {
        await stage.pose(base, { duration: 450 });
        continue;
      }
      await stage.pose(blendPoses(base, basic.relaxed!, 0.2), { duration: 450 });
      await stage.pose(base, { duration: 450 });
    }
  }
});
