import { HandStage } from 'handworks';

const stage = new HandStage({ container: document.getElementById('stage')! });
const hand = await stage.addHand({ side: 'right' });

const textInput = document.getElementById('text') as HTMLInputElement;
const speedInput = document.getElementById('speed') as HTMLInputElement;
const speedOut = document.getElementById('speedOut') as HTMLOutputElement;
const letterDiv = document.getElementById('letter')!;

speedInput.addEventListener('input', () => {
  speedOut.textContent = Number(speedInput.value).toFixed(1);
});

document.getElementById('play')!.addEventListener('click', async () => {
  letterDiv.textContent = '';
  await hand.fingerspell(textInput.value, {
    lettersPerSecond: Number(speedInput.value),
    onLetter: (letter) => {
      letterDiv.textContent = letter;
    },
  });
  letterDiv.textContent = '';
  hand.pose('basic.relaxed', { duration: 500 });
});

document.getElementById('stop')!.addEventListener('click', () => {
  hand.setPose('basic.relaxed');
  letterDiv.textContent = '';
});
