import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface Member {
  id: string
  name?: string | null
  email: string
  avatar?: { url?: string | null } | null
}

interface WorkspaceMembersCardSimpleProps {
  members: Member[]
  totalCount: number
}

export function WorkspaceMembersCardSimple({
  members,
  totalCount,
}: WorkspaceMembersCardSimpleProps) {
  // Show up to 8 avatars
  const displayMembers = members.slice(0, 8)
  const remainingCount = totalCount - displayMembers.length

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Members ({totalCount})</CardTitle>
        <CardDescription>People in this workspace</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">
          Owners
        </p>
        <TooltipProvider>
          <div className="flex flex-wrap gap-1">
            {displayMembers.map((member) => (
              <Tooltip key={member.id}>
                <TooltipTrigger asChild>
                  <Avatar className="h-8 w-8 border-2 border-background">
                    {member.avatar?.url && <AvatarImage src={member.avatar.url} />}
                    <AvatarFallback className="text-xs">
                      {(member.name || member.email)?.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{member.name || member.email}</p>
                </TooltipContent>
              </Tooltip>
            ))}
            {remainingCount > 0 && (
              <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                <span className="text-xs text-muted-foreground">+{remainingCount}</span>
              </div>
            )}
          </div>
        </TooltipProvider>
      </CardContent>
    </Card>
  )
}
