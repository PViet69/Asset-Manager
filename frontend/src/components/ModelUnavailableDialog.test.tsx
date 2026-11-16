import '@testing-library/jest-dom/vitest';
import {useState} from 'react';
import {cleanup,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,test} from 'vitest';
import {ModelUnavailableDialog} from './ModelUnavailableDialog';
import {Button} from './ui/Button';
afterEach(cleanup);
test('model-unavailable dialog restores focus on dismissal',async()=>{function Example(){const[open,setOpen]=useState(false);return <><Button onPress={()=>setOpen(true)}>Search</Button>{open&&<ModelUnavailableDialog onDismiss={()=>setOpen(false)}/>}</>;}render(<Example/>);const user=userEvent.setup();const trigger=screen.getByRole('button',{name:'Search'});await user.click(trigger);expect(screen.getByRole('alertdialog',{name:'Service Unavailable'})).toHaveTextContent('Model not found');await user.click(screen.getByRole('button',{name:'Dismiss search error'}));expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();await waitFor(()=>expect(trigger).toHaveFocus());});
