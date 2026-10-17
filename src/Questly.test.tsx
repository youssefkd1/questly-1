// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import App from './Questly';

beforeEach(()=>localStorage.clear());
afterEach(()=>cleanup());
const clickNav=(label:string)=>{const item=[...document.querySelectorAll<HTMLButtonElement>('.nav-item')].find(x=>x.textContent?.trim().startsWith(label));if(!item)throw new Error(`Missing navigation item: ${label}`);fireEvent.click(item)};

describe('Questly local demo',()=>{
 it('lets a child submit a task and awards its points once after parent approval',()=>{
  render(<App/>);
  fireEvent.click(screen.getByRole('button',{name:/create mission/i}));
  fireEvent.change(screen.getByLabelText('Mission name'),{target:{value:'Test mission'}});
  fireEvent.change(screen.getByLabelText('Reward points'),{target:{value:'7'}});
  fireEvent.click(screen.getByRole('button',{name:/add mission/i}));
  fireEvent.click(document.querySelectorAll<HTMLButtonElement>('.role-switch button')[1]);
  clickNav('Missions');
  const row=screen.getByText('Test mission').closest('.mission-row') as HTMLElement;
  fireEvent.click(within(row).getByRole('button',{name:/start/i}));
  fireEvent.click(document.querySelectorAll<HTMLButtonElement>('.role-switch button')[0]);
  clickNav('Approvals');
  const approval=screen.getByText('Test mission').closest('.approval-card') as HTMLElement;
  fireEvent.click(within(approval).getByRole('button',{name:/approve/i}));
  const saved=JSON.parse(localStorage.getItem('questly-demo-v1')!);
  expect(saved.children.find((c:{id:string})=>c.id==='leo').points).toBe(217);
  expect(saved.approved.filter((id:string)=>id===JSON.parse(localStorage.getItem('questly-demo-v1')!).tasks.find((t:{title:string})=>t.title==='Test mission').id)).toHaveLength(1);
 });

 it('keeps points until a reward request is approved',()=>{
  render(<App/>);
  clickNav('Rewards');
  fireEvent.click(screen.getAllByRole('button',{name:/request/i})[0]);
  expect(screen.getByText('210')).toBeInTheDocument();
  clickNav('Approvals');
  const request=screen.getByText(/reward request: choose family movie/i).closest('.approval-card') as HTMLElement;
  fireEvent.click(within(request).getByRole('button',{name:/approve/i}));
  clickNav('Rewards');
  expect(screen.getByText('130')).toBeInTheDocument();
 });
});
