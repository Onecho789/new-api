/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'

import type { TaskLog } from '../../types'
import { TaskDetailsDialog } from '../dialogs/task-details-dialog'

test.each([
  { role: 'user', isAdmin: false, isRoot: false },
  { role: 'admin', isAdmin: true, isRoot: false },
  { role: 'root', isAdmin: true, isRoot: true },
])(
  'historical mapped task models stay hidden for $role',
  async ({ isAdmin, isRoot }) => {
    const log: TaskLog = {
      id: 1,
      user_id: 1,
      platform: 'video',
      task_id: 'task-public',
      action: 'GENERATE',
      channel_id: 1,
      group: 'default',
      quota: 0,
      submit_time: 1,
      status: 'SUCCESS',
      properties: {
        origin_model_name: 'public-video-model',
        upstream_model_name: 'private-upstream-model',
      },
    }
    render(
      <TaskDetailsDialog
        log={log}
        isAdmin={isAdmin}
        isRoot={isRoot}
        open
        onOpenChange={() => undefined}
      />
    )
    expect(await screen.findByText('public-video-model')).toBeVisible()
    expect(screen.queryByText('private-upstream-model')).not.toBeInTheDocument()
    expect(screen.queryByText('Actual Model')).not.toBeInTheDocument()
  }
)
